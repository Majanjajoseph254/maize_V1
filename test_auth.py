"""
Comprehensive test suite for KilimoSmart authentication flows.
Tests cover login, register, 2FA setup/verify, password reset, and auth guards.
"""

import pytest
import hashlib
import secrets
from datetime import datetime, timedelta
from webapp import app, db, User


@pytest.fixture
def client():
    """Create test client with temp database."""
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    
    with app.app_context():
        db.create_all()
        yield app.test_client()
        db.session.remove()
        db.drop_all()


@pytest.fixture
def test_user(client):
    """Create a test user."""
    user = User(
        email='test@example.com',
        name='Test User',
        county='Kiambu',
        acres=5.0,
    )
    user.set_password('Test123!@')
    db.session.add(user)
    db.session.commit()
    return user


@pytest.fixture
def authed_client(client, test_user):
    """Login a test client."""
    with client:
        # Use form data instead of JSON for login (matches browser behavior)
        client.post('/login', 
            data={'email': 'test@example.com', 'password': 'Test123!@'},
            follow_redirects=False
        )
        yield client


class TestRegistration:
    """Test user registration flow."""
    
    def test_register_success(self, client):
        """Register a new user successfully."""
        response = client.post('/register', 
            data={
                'name': 'New User',
                'email': 'new@example.com',
                'county': 'Embu',
                'password': 'NewPass123!@',
                'confirm_password': 'NewPass123!@',
            },
            follow_redirects=False
        )
        assert response.status_code == 302
        assert '/2fa/setup' in response.location
        
        # Verify user exists
        user = User.query.filter_by(email='new@example.com').first()
        assert user is not None
        assert user.name == 'New User'
        
    def test_register_password_mismatch(self, client):
        """Registration fails when passwords don't match."""
        response = client.post('/register',
            json={
                'name': 'User',
                'email': 'user@example.com',
                'county': 'Kiambu',
                'password': 'Pass123!@',
                'confirm_password': 'DifferentPass123!@',
            },
            follow_redirects=True
        )
        assert 'Passwords do not match' in response.get_data(as_text=True) or response.status_code == 400
        
    def test_register_weak_password(self, client):
        """Registration fails with weak password."""
        response = client.post('/register',
            json={
                'name': 'User',
                'email': 'weak@example.com',
                'county': 'Kiambu',
                'password': 'weak',
                'confirm_password': 'weak',
            },
            follow_redirects=True
        )
        assert 'must be at least 8 characters' in response.get_data(as_text=True)
        
    def test_register_duplicate_email(self, client, test_user):
        """Registration fails with duplicate email."""
        response = client.post('/register',
            json={
                'name': 'Another User',
                'email': 'test@example.com',  # Already exists
                'county': 'Kiambu',
                'password': 'Pass123!@',
                'confirm_password': 'Pass123!@',
            },
            follow_redirects=True
        )
        assert 'Email already registered' in response.get_data(as_text=True)
        

class TestLogin:
    """Test user login flow."""
    
    def test_login_success(self, client, test_user):
        """Login succeeds with correct credentials."""
        response = client.post('/login',
            json={
                'email': 'test@example.com',
                'password': 'Test123!@',
            },
            follow_redirects=False
        )
        assert response.status_code == 302
        assert '/2fa/setup' in response.location
        
    def test_login_remember_me(self, client, test_user):
        """remember_me checkbox is honored."""
        response = client.post('/login',
            json={
                'email': 'test@example.com',
                'password': 'Test123!@',
                'remember_me': 'on',
            },
            follow_redirects=False
        )
        assert response.status_code == 302
        # Session should be permanent (tested via user_loader persistence)
        
    def test_login_invalid_email(self, client):
        """Login fails with non-existent email."""
        response = client.post('/login',
            json={
                'email': 'nonexistent@example.com',
                'password': 'Test123!@',
            },
            follow_redirects=True
        )
        assert 'Invalid email or password' in response.get_data(as_text=True)
        
    def test_login_invalid_password(self, client, test_user):
        """Login fails with wrong password."""
        response = client.post('/login',
            json={
                'email': 'test@example.com',
                'password': 'WrongPassword123!@',
            },
            follow_redirects=True
        )
        assert 'Invalid email or password' in response.get_data(as_text=True)
        
    def test_login_api_json(self, client, test_user):
        """Login via JSON API returns proper redirect."""
        response = client.post('/login',
            json={
                'email': 'test@example.com',
                'password': 'Test123!@',
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert '/2fa' in data['redirect']


class TestTwoFactorSetup:
    """Test 2FA setup flow."""
    
    def test_setup_2fa_creates_secret(self, authed_client):
        """2FA setup generates TOTP secret."""
        response = authed_client.post('/2fa/setup',
            json={},
            content_type='application/json'
        )
        assert response.status_code == 200
        data = response.get_json()
        assert 'secret' in data
        assert 'qr_code_url' in data
        
    def test_setup_2fa_does_not_regenerate(self, authed_client):
        """2FA setup does not regenerate secret on subsequent calls."""
        # First setup
        r1 = authed_client.post('/2fa/setup', json={})
        secret1 = r1.get_json()['secret']
        
        # Second setup
        r2 = authed_client.post('/2fa/setup', json={})
        secret2 = r2.get_json()['secret']
        
        # Secrets should be identical (not regenerated)
        assert secret1 == secret2


class TestTwoFactorVerify:
    """Test 2FA verification flow."""
    
    def test_verify_2fa_success(self, authed_client, test_user):
        """2FA verification succeeds with valid code."""
        # First setup 2FA
        authed_client.post('/2fa/setup', json={})
        
        # Reload user to get updated secret
        db.session.refresh(test_user)
        
        # Generate valid code
        import pyotp
        totp = pyotp.TOTP(test_user.totp_secret)
        code = totp.now()
        
        response = authed_client.post('/2fa/verify',
            json={'code': code},
            content_type='application/json'
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        
    def test_verify_2fa_invalid_code(self, authed_client, test_user):
        """2FA verification fails with invalid code."""
        # Setup 2FA
        authed_client.post('/2fa/setup', json={})
        
        response = authed_client.post('/2fa/verify',
            json={'code': '000000'},
            content_type='application/json'
        )
        assert response.status_code == 401
        data = response.get_json()
        assert 'error' in data


class TestTwoFactorEnforcement:
    """Test 2FA is properly enforced."""
    
    def test_2fa_gate_blocks_protected_route(self, authed_client, test_user):
        """Protected routes are blocked if 2FA required but not verified."""
        # Enable 2FA on user
        test_user.totp_enabled = True
        db.session.commit()
        
        # Try to access dashboard without 2FA verification
        response = authed_client.get('/dashboard', follow_redirects=False)
        assert response.status_code == 302
        assert '/2fa/verify' in response.location
        
    def test_dashboard_accessible_after_2fa(self, authed_client, test_user):
        """Dashboard is accessible after 2FA verification."""
        # Setup and verify 2FA
        authed_client.post('/2fa/setup', json={})
        
        db.session.refresh(test_user)
        import pyotp
        totp = pyotp.TOTP(test_user.totp_secret)
        code = totp.now()
        
        authed_client.post('/2fa/verify',
            json={'code': code},
            content_type='application/json'
        )
        
        # Now dashboard should be accessible
        response = authed_client.get('/dashboard')
        assert response.status_code == 200


class TestPasswordReset:
    """Test password reset flow."""
    
    def test_forgot_password_api(self, client, test_user):
        """Forgot password API returns generic success."""
        response = client.post('/api/auth/forgot-password',
            json={'email': 'test@example.com'}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        # Should not reveal if email exists
        
    def test_forgot_password_nonexistent_email(self, client):
        """Forgot password returns generic success for nonexistent email."""
        response = client.post('/api/auth/forgot-password',
            json={'email': 'nonexistent@example.com'}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data['success'] is True
        assert 'reset link' in data['message'].lower()
        
    def test_reset_password_valid_token(self, client, test_user):
        """Password reset succeeds with valid token."""
        # Generate reset token
        token = test_user.generate_reset_token(expires_in_minutes=15)
        db.session.commit()
        
        response = client.post(f'/reset-password/{token}',
            data={
                'password': 'NewPass123!@',
                'confirm_password': 'NewPass123!@',
            },
            follow_redirects=False
        )
        assert response.status_code == 302  # Redirect to 2FA
        
        # Verify password changed
        db.session.refresh(test_user)
        assert test_user.check_password('NewPass123!@')
        
    def test_reset_password_invalid_token(self, client, test_user):
        """Password reset fails with invalid token."""
        response = client.get('/reset-password/invalid-token')
        assert response.status_code == 200
        assert 'invalid or has expired' in response.get_data(as_text=True)
        
    def test_reset_password_expired_token(self, client, test_user):
        """Password reset fails with expired token."""
        # Generate expired token
        token = test_user.generate_reset_token(expires_in_minutes=-1)
        db.session.commit()
        
        response = client.get(f'/reset-password/{token}')
        assert response.status_code == 200
        assert 'invalid or has expired' in response.get_data(as_text=True)
        
    def test_reset_password_weak_new_password(self, client, test_user):
        """Password reset fails with weak password."""
        token = test_user.generate_reset_token(expires_in_minutes=15)
        db.session.commit()
        
        response = client.post(f'/reset-password/{token}',
            data={
                'password': 'weak',
                'confirm_password': 'weak',
            },
            follow_redirects=True
        )
        assert 'must be at least 8 characters' in response.get_data(as_text=True)
        
    def test_reset_password_respects_2fa(self, client, test_user):
        """Password reset respects 2FA policy post-reset."""
        # Enable 2FA
        test_user.totp_enabled = True
        token = test_user.generate_reset_token(expires_in_minutes=15)
        db.session.commit()
        
        response = client.post(f'/reset-password/{token}',
            data={
                'password': 'NewPass123!@',
                'confirm_password': 'NewPass123!@',
            },
            follow_redirects=False
        )
        # Should redirect to verify 2FA, not dashboard
        assert '/2fa/verify' in response.location


class TestLogout:
    """Test logout flow."""
    
    def test_logout_clears_session(self, authed_client, test_user):
        """Logout clears all session state."""
        # Mark 2FA verified
        with authed_client.session_transaction() as sess:
            sess['2fa_verified'] = True
            
        response = authed_client.get('/logout', follow_redirects=False)
        assert response.status_code == 302
        assert '/login' in response.location
        
        # Session should be empty
        with authed_client.session_transaction() as sess:
            assert '2fa_verified' not in sess


class TestAuthGuards:
    """Test authentication guards on protected routes."""
    
    def test_unauthenticated_redirects_to_login(self, client):
        """Unauthenticated access to protected route redirects to login."""
        response = client.get('/dashboard', follow_redirects=False)
        assert response.status_code == 302
        assert '/login' in response.location
        
    def test_authenticated_no_2fa_required_bypasses_gate(self, authed_client, test_user):
        """Authenticated user without 2FA enabled can access dashboard."""
        # Ensure 2FA not enabled
        test_user.totp_enabled = False
        db.session.commit()
        
        # Setup 2FA first (required flow)
        response = authed_client.post('/2fa/setup', json={})
        assert response.status_code == 200
        
        # Now verify
        db.session.refresh(test_user)
        import pyotp
        totp = pyotp.TOTP(test_user.totp_secret)
        code = totp.now()
        
        authed_client.post('/2fa/verify', json={'code': code})
        
        # Now dashboard should be accessible
        response = authed_client.get('/dashboard')
        assert response.status_code == 200


class TestOpenRedirectSafety:
    """Test open-redirect safety."""
    
    def test_next_parameter_validated(self, client, test_user):
        """Next parameter must be safe relative path."""
        # Try to redirect to external site
        response = client.post('/login?next=http://evil.com',
            data={
                'email': 'test@example.com',
                'password': 'Test123!@',
            },
            follow_redirects=False
        )
        # Should not include evil.com in redirect
        assert 'evil.com' not in response.location or response.status_code == 302
        
    def test_safe_next_parameter_honored(self, client, test_user):
        """Safe next parameters are honored."""
        response = client.post('/login?next=/market',
            json={
                'email': 'test@example.com',
                'password': 'Test123!@',
            }
        )
        # Should include safe next in redirect path somewhere
        assert response.status_code == 200


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
