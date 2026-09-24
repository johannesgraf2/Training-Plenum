"""Personal images for the start page: the hero background and the race-goal photo.

Images stay on this machine inside the upload folder, like the original FIT files.
The hero background has three modes: the bundled illustration, an uploaded photo, or none.
"""
import json
import os

from flask import jsonify, request, send_from_directory

SLOTS = {'background': 'home-background', 'race-goal': 'race-goal'}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
BACKGROUND_MODES = ('default', 'custom', 'none')


def image_type(head):
    """Return the file extension for JPEG, PNG or WebP bytes, otherwise None."""
    if head.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    return None


def register_appearance(app):
    # Created on the first upload, so a fresh install keeps an untouched upload folder.
    folder = os.path.join(app.config['UPLOAD_FOLDER'], 'appearance')
    settings_path = os.path.join(folder, 'settings.json')

    def stored_file(slot):
        prefix = SLOTS[slot] + '.'
        names = sorted(os.listdir(folder)) if os.path.isdir(folder) else []
        return next((name for name in names if name.startswith(prefix)), None)

    def settings():
        try:
            with open(settings_path, encoding='utf-8') as handle:
                value = json.load(handle)
        except (OSError, ValueError):
            value = {}
        mode = value.get('background') if value.get('background') in BACKGROUND_MODES else 'default'
        if mode == 'custom' and not stored_file('background'):
            mode = 'default'
        return {'background': mode}

    def save_settings(value):
        os.makedirs(folder, exist_ok=True)
        with open(settings_path, 'w', encoding='utf-8') as handle:
            json.dump(value, handle)

    def state():
        def url(slot):
            name = stored_file(slot)
            # The modification time busts the browser cache after a replacement.
            return f'/api/appearance/{slot}/image?v={int(os.path.getmtime(os.path.join(folder, name)))}' if name else None
        return {**settings(), 'backgroundImage': url('background'), 'raceGoalImage': url('race-goal')}

    def remove(slot):
        name = stored_file(slot)
        if name:
            os.remove(os.path.join(folder, name))

    @app.route('/api/appearance', methods=['GET', 'PUT'])
    def appearance():
        if request.method == 'PUT':
            data = request.get_json(silent=True)
            if not isinstance(data, dict) or data.get('background') not in BACKGROUND_MODES:
                return jsonify({'error': 'background: Bitte „default“, „custom“ oder „none“ senden.'}), 400
            if data['background'] == 'custom' and not stored_file('background'):
                return jsonify({'error': 'Bitte zuerst ein eigenes Hintergrundbild hochladen.'}), 400
            save_settings({'background': data['background']})
        return jsonify(state())

    @app.route('/api/appearance/<slot>/image', methods=['GET', 'POST', 'DELETE'])
    def appearance_image(slot):
        if slot not in SLOTS:
            return jsonify({'error': 'Unbekannter Bildplatz.'}), 404
        if request.method == 'GET':
            name = stored_file(slot)
            if not name:
                return jsonify({'error': 'Kein Bild gespeichert.'}), 404
            return send_from_directory(folder, name, max_age=0)
        if request.method == 'DELETE':
            remove(slot)
            if slot == 'background' and settings()['background'] != 'none':
                save_settings({'background': 'default'})
            return jsonify(state())

        upload = request.files.get('file')
        if not upload:
            return jsonify({'error': 'Bitte eine Bilddatei auswählen.'}), 400
        content = upload.read(MAX_IMAGE_BYTES + 1)
        if len(content) > MAX_IMAGE_BYTES:
            return jsonify({'error': 'Das Bild darf höchstens 10 MB groß sein.'}), 400
        extension = image_type(content[:12])
        if not extension:
            return jsonify({'error': 'Bitte ein JPEG-, PNG- oder WebP-Bild hochladen.'}), 400
        remove(slot)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, f'{SLOTS[slot]}.{extension}'), 'wb') as handle:
            handle.write(content)
        if slot == 'background':
            save_settings({'background': 'custom'})
        return jsonify(state()), 201
