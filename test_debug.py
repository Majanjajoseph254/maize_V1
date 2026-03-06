"""Quick debug test for Flask test client"""
import sys
from webapp import app, db, User

# Setup test app
app.config['TESTING'] = True
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

with app.app_context():
    db.create_all()
    
    # Test register with JSON
    client = app.test_client()
    print("Testing /register with json={}")
    response = client.post('/register', json={
        'name': 'Test User',
        'email': 'test@example.com',
        'county': 'Kiambu',
        'password': 'TestPass123!@',
        'confirm_password': 'TestPass123!@',
    }, follow_redirects=False)
    
    print(f"Status Code: {response.status_code}")
    print(f"Content-Type: {response.content_type}")
    print(f"Response Data (first 200 chars): {response.get_data(as_text=True)[:200]}")
    print(f"Response Headers: {dict(response.headers)}")
    print("")
    
    # Test login with JSON
    print("Testing /login with json={}")
    response = client.post('/login', json={
        'email': 'test@example.com',
        'password': 'TestPass123!@',
    }, follow_redirects=False)
    
    print(f"Status Code: {response.status_code}")
    print(f"Content-Type: {response.content_type}")
    print(f"Response Data (first 200 chars): {response.get_data(as_text=True)[:200]}")
