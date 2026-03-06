import io

import pytest
from PIL import Image

import webapp
from webapp import app, db, User


@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.drop_all()
        db.create_all()
        webapp._ensure_schema_columns()

        user = User(
            email='farmer@example.com',
            name='Farmer One',
            county='Kiambu',
            acres=4,
            phone='+254700000001',
        )
        user.set_password('StrongPass123!')
        db.session.add(user)
        db.session.commit()

        yield app.test_client()

        db.session.remove()
        db.drop_all()


def _login_session(client):
    with client.session_transaction() as session:
        session['_user_id'] = '1'
        session['_fresh'] = True


def _image_file(name='leaf.png'):
    img = Image.new('RGB', (32, 32), color=(30, 180, 40))
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return buf, name


def test_diagnose_success_payload_is_enriched(client, monkeypatch):
    _login_session(client)

    def fake_diagnose(_img, include_internal_scores=False):
        payload = {
            'diagnosis': 'Common Rust',
            'confidence': 0.91,
            'severity': 'med',
            'detected_object': 'Maize Leaf',
        }
        if include_internal_scores:
            payload['internal_scores'] = {'leaf_confidence': 0.92}
        return payload

    monkeypatch.setattr(webapp, 'diagnose_leaf_disease', fake_diagnose)

    img, filename = _image_file()
    resp = client.post(
        '/api/diagnose?debug=1',
        data={'image': (img, filename)},
        content_type='multipart/form-data',
    )

    assert resp.status_code == 200
    data = resp.get_json()

    assert data['status'] == 'success'
    assert data['diagnosis'] == 'Common Rust'
    assert 'confidence' in data
    assert data['severity'] == 'med'
    assert data['disease_sw']
    assert data['treatment']['medication']
    assert data['treatment']['prevention']
    assert data['mvp_summary']
    assert data['analyzed_at']
    assert data['internal_scores']['leaf_confidence'] == 0.92


def test_profile_put_persists_fields(client):
    _login_session(client)

    resp = client.put(
        '/api/user',
        json={
            'name': 'Updated Farmer',
            'county': 'Nakuru',
            'acres': 9,
            'phone': '+254700123456',
        },
    )

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload['success'] is True

    with app.app_context():
        user = User.query.get(1)
        assert user.name == 'Updated Farmer'
        assert user.county == 'Nakuru'
        assert int(user.acres) == 9
        assert user.phone == '+254700123456'


def test_profile_photo_upload_succeeds(client):
    _login_session(client)

    img, filename = _image_file('profile.png')
    resp = client.post(
        '/api/user/photo',
        data={'photo': (img, filename)},
        content_type='multipart/form-data',
    )

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload['success'] is True
    assert payload['profile_photo_url'].startswith('/static/uploads/profiles/')


def test_report_ui_wiring_exists():
    with open('templates/index.html', encoding='utf-8') as f:
        html = f.read()
    with open('static/js/app.js', encoding='utf-8') as f:
        js = f.read()

    assert 'diagnoseReportActions' in html
    assert 'printAnalysisReport' in js
