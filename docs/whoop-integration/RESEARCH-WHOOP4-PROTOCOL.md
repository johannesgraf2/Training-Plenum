# WHOOP 4.0 BLE protocol: facts for our own implementation

Sources are the noop project docs (https://github.com/ryanbr/noop/tree/main/docs): `PROTOCOL.md`, `PROTOCOL_WHOOP4.md`, `PROTOCOL_TRANSPORT.md`, `PROTOCOL_COMMANDS.md`, `PROTOCOL_SENSORS.md`, `PROTOCOL_CONCEPTS.md`, `PROTOCOL_IMPLEMENTATION.md`, `BLE_REVERSE_ENGINEERING.md` and `protocol-examples/validate_examples.py`.

noop's LICENSE says that protocol facts (UUIDs, frame layouts, CRC parameters, command numbers, offsets) are not copyrightable and may be reused freely. **This page therefore contains facts only, no noop code.** The noop code itself is PolyForm Noncommercial and must not be copied.

Scope: WHOOP 4.0, firmware MAXIM 41.17.6.0 / NORDIC 17.2.2.0. Everything marked "⚠ check on device" is unclear or depends on the firmware.

## 1. GATT, write type, bonding
| Role | UUID | Direction |
|---|---|---|
| Custom service | `61080001-8d6d-82b8-614a-1c8cb0f8dcc6` | — |
| Command write | `61080002-8d6d-82b8-614a-1c8cb0f8dcc6` | app → strap |
| Command response notify | `61080003-8d6d-82b8-614a-1c8cb0f8dcc6` | strap → app |
| Event notify | `61080004-8d6d-82b8-614a-1c8cb0f8dcc6` | strap → app |
| Data notify (fragmented) | `61080005-8d6d-82b8-614a-1c8cb0f8dcc6` | strap → app |
| Standard Heart Rate | `180D` / `2A37` | notify, about 1 Hz, works without bonding |
| Standard Battery | `180F` / `2A19` | 1 byte, % (some units always report 100, so don't trust it) |

- **Subscribe to** 0003, 0004, 0005, 2A37 and 2A19. Feed **one shared reassembler** from 0003, 0004 and 0005.
- **Write type:** always write *with response* (bleak `response=True`).
- **Bonding:** the first confirmed write of `GET_BATTERY_LEVEL` (26) to 0002 triggers just-works bonding with no PIN. "Write acknowledged without error" means the link is usable. That is not proof of a lasting OS bond. On macOS, CoreBluetooth handles the pairing.
- **Pairing setup:** while bonding, the strap must be unpaired from the official WHOOP app or out of its range, and worn and charged.
  - ⚠ How to unbond it from the official app is not documented. Try "forget device" in the WHOOP app and switching off Bluetooth on the phone.
- **MTU:** no fixed value. Fragments are MTU-sized and the reassembler accepts any size.

## 2. Frame envelope
```
[0]=0xAA  [1..2]=len u16le  [3]=crc8  [4]=type  [5]=seq  [6]=cmd  [7..len)=payload  [len..len+4)=crc32 u32le
len = 3 + payload_len + 4 ; total frame size = len + 4 ; minimum len 7 (total 11)
```
- **CRC8:**
  - Polynomial 0x07, init 0x00, not reflected, no final XOR. This is CRC-8/SMBUS; check value of "123456789" is 0xF4.
  - Covers **only** bytes [1] and [2], the length field.
- **CRC32:**
  - Standard zlib CRC (reflected, polynomial 0xEDB88320, init and final XOR 0xFFFFFFFF).
  - Covers `frame[4:len]`, stored little-endian at offset `len`.
- **Accept a frame only if:**
  - len ≥ 7
  - len + 4 ≤ the number of bytes received
  - CRC8 matches
  - CRC32 matches

  A CRC failure is a local parse error, not a result code.
- **Packet types (`[4]`):**

  | Value | Meaning | Notes |
  |---|---|---|
  | 35 | command | app → strap |
  | 36 | command response | |
  | 40 | realtime HR | |
  | 43 | realtime raw | |
  | 47 | historical data | |
  | 48 | event | event number at [6], timestamp u32 at [8] |
  | 49 | metadata | |
  | 50 | console log | |

- **Response layout:**
  - `[6]` command
  - `[7]` the sequence number of your request
  - `[8]` result: 0 fail / 1 ok / 2 pending / 3 unsupported
  - body from `[9]`

  Match a reply on (command, request seq). `[5]` is the reply's own sequence, not an echo. One request can produce a pending reply followed by a final one, or several valid replies.
- **Sequence:** 8-bit, wraps. On type-47 records, `[5]` is the **record layout version**, not a sequence.
- **Reassembly:**
  1. Drop bytes before 0xAA.
  2. Wait for 4 bytes, then read len.
  3. Wait until len + 4 bytes have arrived.
  4. Discard sizes above 8192 or below 11, then resync.
  5. Reset the buffer on disconnect.

## 3. Commands (type 35, written to 0002)
### Connection sequence: run **exactly once per connection**
Re-running it mid-offload makes the strap stop sending type-47 data.

| # | Command | Body | Notes |
|---|---|---|---|
| 1 | 26 `GET_BATTERY_LEVEL` | `00` | Bonding write. Reply body u16le ÷ 10 = %. ⚠ May get no reply on newer firmware. Fallback is event 3: SoC at frame[17] (u16le ÷ 10), mV at [21] (u16le), charging = [26] & 1. |
| 2 | 35 `GET_HELLO_HARVARD` | `00` | Optional. 131-byte body (from frame[9]). Serial at body offset 14: 9 characters + NUL. **Offsets 24–77 hold key and signature material: never log them or use them as an ID.** |
| 3 | 76 `GET_ADVERTISING_NAME_HARVARD` | `00` | |
| 4 | 7 `REPORT_VERSION_INFO` | empty or `00` | 68-byte body: revision (1) @0, 4× u32le Harvard @1, 4× u32le Boylston @17 |
| 5 | 10 `SET_CLOCK` | `secs u32le + 00×4` (8 bytes) **or** `+ 00×5` (9 bytes) | ⚠ Which form the device accepts varies. Read the clock back. |
| 6 | 11 `GET_CLOCK` | empty or `00` | |
| 7 | 63 `SEND_R10_R11_REALTIME` | `00` | Stops the raw type-43 stream (about 2 × 1.9 KB/s). `01` turns it on. Reportedly stays off across reconnects. Command 82 does **not** stop this stream. |
| 8 | 34 `GET_DATA_RANGE` | `00` | The WHOOP 4 reply is not the 65-byte WHOOP 5 layout. Several replies are possible; only for diagnostics. |
| 9 | wait about 1.5 s, then start the offload | | |

### History offload
1. **Start:** 22 `SEND_HISTORICAL_DATA`, body `00`. The reply only means "accepted". Data then arrives asynchronously on 0005.
2. **Metadata frames:** type 49, kind at [6]: 1 = HISTORY_START, 2 = HISTORY_END, 3 = HISTORY_COMPLETE.
3. **Flow:** one START, then repeated chunks of type-47 records, each closed by an END (about one END per 50 records), then COMPLETE. The next chunk follows automatically after each ACK.
4. **HISTORY_END** (25 bytes, length field 21):

   | Offset | Type | Field |
   |---|---|---|
   | [7] | u32le | unix |
   | [11] | u16le | subsec |
   | [13] | u32 | reserved |
   | [17] | u32le | trim cursor |

   The 8-byte **token** = `frame[17:25]` (trim cursor plus wrap state).
   - ⚠ The token overlaps the CRC area according to the docs. Check on the device and frame it exactly that way.
5. **ACK:** 23 `HISTORICAL_DATA_RESULT`, body `01` + the token's 8 bytes **unchanged**, written with response.
   - Never rebuild the token yourself.
   - Also ACK an END that had no records; that is how the offload moves forward.
6. **Safe-trim rule:**
   - First durably commit the chunk: decoded rows, raw frames, any records that could not be decoded, and the cursor. **Only then send the ACK.** Any failure means no ACK.
   - The ACK lets the strap free that storage.
   - In our design, "durably" means the bridge's local SQLite outbox.
7. **Strap behaviour:**
   - An unanswered END is resent up to 4 times. The 5th failure ends the attempt.
   - The next attempt replays from the last acknowledged point, so duplicates are normal.
8. **Abort:** 20 `ABORT_HISTORICAL_TRANSMITS`, body `00`. It stops the offload without trimming.
9. **Watchdog:** a 60-second idle timer, reset only by types 47/48/49/50 (not 40/43). On timeout, end the session; it resumes later from the cursor.
10. **noop's cadence:**
    - Offload every 15 min.
    - Every 30 s, re-arm realtime and poll battery.
    - Recovery: 97 `EXIT_HIGH_FREQ_SYNC` (body `00`) plus SET_CLOCK. **Never 96.**

### **Never send** (destructive)
| Code | Command |
|---|---|
| 15 | `FORGET_BONDS` |
| 25 | `FORCE_TRIM` |
| 29 | `REBOOT_STRAP` |
| 32 | `POWER_CYCLE_STRAP` |
| 33 | `SET_READ_POINTER` |
| 36, 37, 38 | firmware load |
| 45 | `ENTER_BLE_DFU` |
| 83 | `VERIFY_FIRMWARE_IMAGE` |
| 99 | `RESET_FUEL_GAUGE` |
| 142–144 | firmware load |

`build_command` should refuse these hard.

## 4. Record layouts (absolute offsets in the full frame)
### Type 47, version 24 (version byte at [5]; the 41.17.6.0 default, confirmed on 1,704 frames)
| Offset | Type | Field |
|---|---|---|
| 11 | u32le | unix seconds |
| 21 | u8 | HR (bpm) |
| 22 | u8 | R-R count |
| 23 | u16le × count | R-R in ms; skip zero values |
| 33, 35 | u16 | raw optical (green, red/IR) |
| 40 / 44 / 48 | f32le | gravity x / y / z in g (magnitude ≈ 1) |
| 55 | u8 | skin contact (0 = off wrist) |
| 56 / 60 / 64 | f32le | second gravity vector |
| 68 / 70 | u16 | SpO₂ red / IR raw (not a percentage) |
| 72 | u16 | skin temperature raw ADC (not °C) |
| 74 | u16 | ambient light |
| 76 / 78 | u16 | LED drive |
| 80 | u16 | respiration raw (not breaths/min) |
| 82 | u16 | signal-quality word |

v24 has no documented sub-second field.

### Type 47, version 25 (84-byte frame)
- `[5]` = 25
- unix u32le @11
- sensor block from @23
- gravity as 3× i16le @73/75/77, ÷ 16384 = g (an observed scale, not a confirmed one)
- **no HR field**

Pick the decoder by version byte **and** frame length. Never shift offsets between layouts. On an unknown version, keep the raw frame and mark it "undecoded".

### Type 40 (realtime)
- unix u32 @6, subsec u16 @10
- HR u8 @12, R-R count u8 @13
- R-R u16 values in ms @14 + 2n

### Type 43 (realtime raw)
Common prefix: unix @15, subsec @19–20. Then select by payload length (len − 7):
- **1917 (IMU):**
  - HR @21, R-R count @22, 4× R-R @23–30
  - Accelerometer: 100 × i16le each @89/289/489, ÷ 4096 = g
  - Gyro @692/892/1092, × 2000/32768 = °/s
- **1921 (optical):** signed 24-bit LE samples from @42 with stride 4, up to 419 samples.

Not needed for v1; we switch the stream off with command 63.

### Standard 2A37
Flags byte:
- bit 0: HR is u16 instead of u8
- bit 3: energy-expended u16 present
- bit 4: R-R values present, as u16 in 1/1024 s; ms = `(ticks*1000+512)//1024`

## 5. How noop maps this into tables (for orientation)
- **`rrInterval(ts, rrMs, seq, ord)`:**
  - `seq` counts repeats of the same rrMs within one second.
  - `ord` is the **arrival order** within a second. Sort RMSSD input by it, never by value, or RMSSD comes out biased low.
- **`hrSample(ts, bpm)`:**
  - `DATA_MODEL.md` says it comes only from type 40.
  - The Android import, however, also uses historical HR.
  - We take HR from type 47 v24.
- **Raw-value tables:** `gravitySample(x, y, z)` stores doubles in g; `skinTempSample(raw)`, `respSample(raw)` and `spo2Sample(red, ir)` store raw values.
- **Deduplication:** every insert uses `ON CONFLICT DO NOTHING` on the natural key.
- **Clock:** historical records use their own unix time, with no clock offset applied.
- **No daily SpO₂ or skin temp on 4.0:** noop does not derive these from WHOOP 4 raw values; the daily fields stay null.

## 6. Unit-test fixtures
**Event frames:** CRC8 and CRC32 were recomputed and match the capture docs.
- `aa 14 00 03 30 fc 44 00 3c ee 63 6a 80 7e 04 00 01 01 ff 00 58 2e c2 81`
  - len 20, type 48 (0x30), event 0x44 = 68, timestamp `0x6a63ee3c`, CRC32 `0x81c22e58`
- `aa 14 00 03 30 0a 66 00 9e ee 63 6a 60 48 04 00 01 01 00 00 34 0e 63 88`
  - event 0x66, CRC32 `0x88630e34`

**CRC8 of the length bytes:** `14 00`→`03`, `1c 00`→`ab`, `08 00`→`a8`, `07 00`→`6b`.

**Command frames:** built with our own CRC routine. Check them in a test against our `build_command`.

| Request | Frame |
|---|---|
| 26, seq 0, body `00` | `aa 08 00 a8 23 00 1a 00 17 25 ee 23` |
| 35, seq 1, body `00` | `aa 08 00 a8 23 01 23 00 9a c2 a8 2c` |
| 7, seq 2, body `00` | `aa 08 00 a8 23 02 07 00 65 9d 06 df` |
| 63 off, seq 3 | `aa 08 00 a8 23 03 3f 00 a9 4b 5b c9` |
| 34, seq 4 | `aa 08 00 a8 23 04 22 00 30 31 78 33` |
| 22, seq 5 | `aa 08 00 a8 23 05 16 00 f0 a8 90 89` |
| 11 empty, seq 6 | `aa 07 00 6b 23 06 0b a5 5f c2 04` |
| 10 (1700000000, 8-byte form), seq 7 | `aa 0f 00 c3 23 07 0a 00 f1 53 65 00 00 00 00 d4 7a ca 1a` |
| 23 ACK, token (cursor 7, wrap 2), seq 8 | `aa 10 00 57 23 08 17 01 07 00 00 00 02 00 00 00 62 61 7c dc` |
| 20 abort, seq 9 | `aa 08 00 a8 23 09 14 00 16 33 bc b2` |

**From `validate_examples.py`:**
- R-R ticks 512 / 1024 / 1536 → 500 / 1000 / 1500 ms
- the ACK body for token (7, 2) is 9 bytes and starts with `01`

## 7. Pitfalls
- **Duplicates:** anything not acknowledged gets replayed. Deduplicate on natural keys and keep arrival order.
- **Clock:**
  - A successful SET_CLOCK isn't proof; read it back.
  - Event 13 `RTC_LOST` means the strap lost its time.
  - Track clock drift by pairing GET_CLOCK with wall time.
- **Re-handshaking** mid-offload stops type-47 streaming.
- **Interruption:**
  - A lost connection ends the attempt; the next attempt resumes from the last acknowledged point.
  - COMPLETE doesn't prove everything was delivered.
- **Battery:** prefer command 26 or event 3 over 2A19.
- **Capacity:** the docs mention a "14-day biometric store" without a source. The ring uses 4096-byte pages. GET_DATA_RANGE's backlog figure is approximate.
- **Unknown record versions:** keep the raw frame and don't count it as "stored OK".
