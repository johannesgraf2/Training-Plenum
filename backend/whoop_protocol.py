"""WHOOP 4.0 Bluetooth frames: building commands and decoding what the strap sends.

Written from the published protocol facts (UUIDs, frame layout, CRC parameters,
command numbers, offsets) in docs/whoop-integration/RESEARCH-WHOOP4-PROTOCOL.md.
No third-party code. Pure Python without dependencies: the Mac bridge imports
this file as well as the backend.

Frame: [0]=0xAA [1..2]=len u16le [3]=crc8(len bytes) [4]=type [5]=seq [6]=cmd
[7..len)=body [len..len+4)=crc32(frame[4:len]) u32le. All offsets below are
absolute positions in the full frame.
"""
import struct
import zlib

SERVICE_UUID = '61080001-8d6d-82b8-614a-1c8cb0f8dcc6'
COMMAND_UUID = '61080002-8d6d-82b8-614a-1c8cb0f8dcc6'
RESPONSE_UUID = '61080003-8d6d-82b8-614a-1c8cb0f8dcc6'
EVENT_UUID = '61080004-8d6d-82b8-614a-1c8cb0f8dcc6'
DATA_UUID = '61080005-8d6d-82b8-614a-1c8cb0f8dcc6'
HEART_RATE_UUID = '00002a37-0000-1000-8000-00805f9b34fb'

START = 0xAA
MIN_LEN = 7  # type, seq, cmd and the CRC32: an empty body
MAX_FRAME = 8192

# Packet types at [4].
COMMAND, RESPONSE, REALTIME_HR, REALTIME_RAW, HISTORY, EVENT, METADATA, CONSOLE = 35, 36, 40, 43, 47, 48, 49, 50
# Metadata kinds at [6] of a type-49 frame.
HISTORY_START, HISTORY_END, HISTORY_COMPLETE = 1, 2, 3

SET_CLOCK = 10
GET_CLOCK = 11
ABORT_HISTORY = 20
SEND_HISTORY = 22
HISTORY_RESULT = 23
GET_BATTERY = 26
GET_DATA_RANGE = 34
GET_HELLO = 35
REPORT_VERSION = 7
REALTIME_RAW_STREAM = 63
EVENT_BATTERY = 3
EVENT_RTC_LOST = 13

# Destructive commands: forget bonds, force trim, reboot, power cycle, move the read
# pointer, firmware loading, DFU, image verification, fuel-gauge reset, and 96
# (never used for recovery; 97 is). build_command refuses them unconditionally.
FORBIDDEN = frozenset({15, 25, 29, 32, 33, 36, 37, 38, 45, 83, 96, 99, 142, 143, 144})

RESULTS = {0: 'fail', 1: 'ok', 2: 'pending', 3: 'unsupported'}


class ProtocolError(ValueError):
    pass


def crc8(data):
    """CRC-8/SMBUS: polynomial 0x07, init 0, not reflected, no final XOR."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def crc32(data):
    return zlib.crc32(data) & 0xFFFFFFFF


def build_frame(packet_type, seq, cmd, body=b''):
    length = 3 + len(body) + 4
    header = struct.pack('<H', length)
    inner = bytes((packet_type, seq & 0xFF, cmd)) + bytes(body)
    return bytes((START,)) + header + bytes((crc8(header),)) + inner + struct.pack('<I', crc32(inner))


def build_command(cmd, seq, body=b'\x00'):
    if not isinstance(cmd, int) or not 0 <= cmd <= 255:
        raise ProtocolError('Ungültiges Kommando.')
    if cmd in FORBIDDEN:
        raise ProtocolError(f'Kommando {cmd} ist gesperrt.')
    return build_frame(COMMAND, seq, cmd, body)


def set_clock_body(unix_seconds, padding=4):
    """SET_CLOCK takes the seconds plus four or five zero bytes, depending on the firmware."""
    if padding not in (4, 5):
        raise ProtocolError('SET_CLOCK kennt nur die 8- und 9-Byte-Form.')
    return struct.pack('<I', int(unix_seconds)) + bytes(padding)


def ack_history_body(token):
    """HISTORICAL_DATA_RESULT acknowledges one chunk with the END token, byte for byte."""
    token = bytes(token)
    if len(token) != 8:
        raise ProtocolError('Das END-Token muss 8 Byte lang sein.')
    return b'\x01' + token


class Frame:
    __slots__ = ('raw',)

    def __init__(self, raw):
        self.raw = bytes(raw)

    @property
    def length(self):
        return self.raw[1] | self.raw[2] << 8

    @property
    def type(self):
        return self.raw[4]

    @property
    def seq(self):
        return self.raw[5]

    @property
    def cmd(self):
        return self.raw[6]

    @property
    def data(self):
        """Everything before the CRC32, so offsets stay absolute."""
        return self.raw[:self.length]

    def __repr__(self):
        return f'Frame(type={self.type}, seq={self.seq}, cmd={self.cmd}, size={len(self.raw)})'


def frame_error(raw):
    """Why a byte string is not exactly one valid frame, or None."""
    raw = bytes(raw)
    if len(raw) < 4 or raw[0] != START:
        return 'start'
    length = raw[1] | raw[2] << 8
    if length < MIN_LEN or length + 4 > MAX_FRAME:
        return 'length'
    if crc8(raw[1:3]) != raw[3]:
        return 'crc8'
    if len(raw) != length + 4:
        return 'size'
    if crc32(raw[4:length]) != struct.unpack_from('<I', raw, length)[0]:
        return 'crc32'
    return None


def parse_frame(raw):
    error = frame_error(raw)
    if error:
        raise ProtocolError(f'Ungültiger Frame ({error}).')
    return Frame(raw)


class Reassembler:
    """Turns notification fragments from 0003/0004/0005 into whole, CRC-checked frames.

    Bytes before 0xAA are dropped. A header with an impossible length or a bad CRC8,
    and a complete frame with a bad CRC32, cost one byte and resync on the next 0xAA.
    """

    def __init__(self):
        self.buffer = bytearray()
        self.dropped = 0

    def reset(self):
        self.buffer.clear()

    def feed(self, data):
        self.buffer.extend(data)
        frames = []
        while True:
            start = self.buffer.find(START)
            if start < 0:
                self.dropped += len(self.buffer)
                self.buffer.clear()
                return frames
            if start:
                self.dropped += start
                del self.buffer[:start]
            if len(self.buffer) < 4:
                return frames
            length = self.buffer[1] | self.buffer[2] << 8
            if length < MIN_LEN or length + 4 > MAX_FRAME or crc8(self.buffer[1:3]) != self.buffer[3]:
                self.dropped += 1
                del self.buffer[0]
                continue
            if len(self.buffer) < length + 4:
                return frames
            raw = bytes(self.buffer[:length + 4])
            if frame_error(raw):
                self.dropped += 1
                del self.buffer[0]
                continue
            del self.buffer[:length + 4]
            frames.append(Frame(raw))


def parse_response(frame):
    """Type 36: [6] command, [7] the request's seq, [8] result, body from [9]."""
    if frame.type != RESPONSE or frame.length < 9:
        return None
    data = frame.data
    return {'cmd': data[6], 'requestSeq': data[7], 'result': RESULTS.get(data[8], data[8]), 'body': data[9:]}


def parse_event(frame):
    """Type 48: event number at [6], unix seconds at [8]."""
    if frame.type != EVENT or frame.length < 12:
        return None
    data = frame.data
    result = {'event': data[6], 'ts': struct.unpack_from('<I', data, 8)[0]}
    if data[6] == EVENT_BATTERY and len(data) >= 27:
        result['battery'] = {'percent': struct.unpack_from('<H', data, 17)[0] / 10,
                             'millivolts': struct.unpack_from('<H', data, 21)[0],
                             'charging': bool(data[26] & 1)}
    return result


def metadata_kind(frame):
    return frame.cmd if frame.type == METADATA else None


def history_end_token(frame):
    """The 8 bytes at [17:25] of a HISTORY_END frame (trim cursor plus wrap state).

    The documented END frame is 25 bytes long, so this range reaches into the CRC32
    area. It is taken from the raw frame exactly as documented and sent back
    unchanged; it is never rebuilt from parsed values.
    """
    if metadata_kind(frame) != HISTORY_END or len(frame.raw) < 25:
        raise ProtocolError('Kein HISTORY_END-Frame.')
    return frame.raw[17:25]


def battery_from_response(body):
    """GET_BATTERY_LEVEL reply: u16le tenths of a percent."""
    return struct.unpack_from('<H', body, 0)[0] / 10 if len(body) >= 2 else None


def clock_from_response(body):
    return struct.unpack_from('<I', body, 0)[0] if len(body) >= 4 else None


def firmware_from_response(body):
    """REPORT_VERSION_INFO: revision at 0, four u32le Harvard parts at 1, four Boylston at 17."""
    if len(body) < 33:
        return None
    harvard = struct.unpack_from('<4I', body, 1)
    boylston = struct.unpack_from('<4I', body, 17)
    return {'harvard': '.'.join(map(str, harvard)), 'boylston': '.'.join(map(str, boylston))}


def serial_from_hello(body):
    """GET_HELLO_HARVARD: serial at body offset 14 (9 characters + NUL).

    Offsets 24-77 of that body hold key and signature material; nothing here reads them.
    """
    if len(body) < 23:
        return None
    serial = bytes(body[14:23]).split(b'\x00', 1)[0]
    try:
        return serial.decode('ascii') or None
    except UnicodeDecodeError:
        return None


def _u16(data, offset):
    return struct.unpack_from('<H', data, offset)[0] if offset + 2 <= len(data) else None


def _u8(data, offset):
    return data[offset] if offset < len(data) else None


def _f32(data, offset):
    return struct.unpack_from('<f', data, offset)[0] if offset + 4 <= len(data) else None


def _vector(values):
    return tuple(values) if all(value is not None and value == value and abs(value) < 16 for value in values) else None


def decode_history(frame):
    """One type-47 record. The layout is chosen by version byte [5] and frame size.

    Returns a dict with ts, hr, rr (ms, arrival order), gravity (g), contact,
    skinRaw and respRaw where the layout has them. Unknown layouts come back as
    {'undecoded': True, 'version': n}; the raw frame is kept by the caller.
    """
    if frame.type != HISTORY:
        raise ProtocolError('Kein Verlaufsdatensatz.')
    data = frame.data
    version = frame.seq
    if version == 24 and len(data) >= 52:
        count = data[22]
        rr = []
        for index in range(min(count, 4)):
            value = _u16(data, 23 + 2 * index)
            if value:
                rr.append(value)
        return {'version': 24, 'ts': struct.unpack_from('<I', data, 11)[0], 'hr': data[21] or None, 'rr': rr,
                'gravity': _vector((_f32(data, 40), _f32(data, 44), _f32(data, 48))),
                'contact': _u8(data, 55), 'skinRaw': _u16(data, 72), 'respRaw': _u16(data, 80)}
    if version == 25 and len(frame.raw) == 84:
        gravity = struct.unpack_from('<3h', data, 73)
        return {'version': 25, 'ts': struct.unpack_from('<I', data, 11)[0], 'hr': None, 'rr': [],
                'gravity': tuple(value / 16384 for value in gravity), 'contact': None, 'skinRaw': None, 'respRaw': None}
    return {'undecoded': True, 'version': version}


def decode_realtime(frame):
    """Type 40: unix at [6], subsec at [10], HR at [12], R-R count at [13], R-R u16 from [14]."""
    if frame.type != REALTIME_HR or frame.length < 14:
        return None
    data = frame.data
    count = data[13]
    rr = [value for value in (_u16(data, 14 + 2 * index) for index in range(count)) if value]
    return {'ts': struct.unpack_from('<I', data, 6)[0], 'hr': data[12] or None, 'rr': rr}


def rr_ticks_to_ms(ticks):
    return (ticks * 1000 + 512) // 1024


def parse_heart_rate_measurement(value):
    """Standard 0x2A37 notification: flags, HR u8/u16, optional energy, R-R in 1/1024 s."""
    value = bytes(value)
    if len(value) < 2:
        return None
    flags = value[0]
    offset = 1
    if flags & 0x01:
        if len(value) < 3:
            return None
        hr = struct.unpack_from('<H', value, 1)[0]
        offset = 3
    else:
        hr = value[1]
        offset = 2
    if flags & 0x08:
        offset += 2
    rr = []
    if flags & 0x10:
        while offset + 2 <= len(value):
            rr.append(rr_ticks_to_ms(struct.unpack_from('<H', value, offset)[0]))
            offset += 2
    return {'hr': hr or None, 'rr': rr}
