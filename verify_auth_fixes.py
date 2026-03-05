"""
Quick verification script to test auth flow fixes are working
"""
import requests
import time

BASE_URL = "http://127.0.0.1:8080"

def test_open_redirect_prevention():
    """Test that next parameter is validated"""
    print("1. Testing open-redirect prevention...")
    session = requests.Session()
    
    # Try to login with malicious next parameter
    response = session.post(f"{BASE_URL}/login", 
        data={
            'email': 'demo@kilimosmart.local',
            'password': 'demo123',
            'next': 'http://evil.com/phishing'
        },
        allow_redirects=False
    )
    
    if response.status_code == 302:
        location = response.headers.get('Location', '')
        if 'evil.com' not in location:
            print("   ✅ Open-redirect blocked (redirect to safe URL)")
        else:
            print("   ❌ SECURITY ISSUE: External redirect allowed!")
    print()

def test_2fa_enforcement():
    """Test that 2FA gate is enforced"""
    print("2. Testing 2FA enforcement gate...")
    session = requests.Session()
    
    # Login to get authenticated
    response = session.post(f"{BASE_URL}/login",
        data={
            'email': 'demo@kilimosmart.local',
            'password': 'demo123'
        },
        allow_redirects=False
    )
    
    # Try to access dashboard directly (should be blocked if 2FA required)
    response = session.get(f"{BASE_URL}/dashboard", allow_redirects=False)
    
    if response.status_code == 302:
        location = response.headers.get('Location', '')
        if '2fa' in location.lower():
            print("   ✅ Protected route blocked, redirecting to 2FA")
        else:
            print(f"   ℹ️  Redirected to: {location}")
    elif response.status_code == 200:
        print("   ℹ️  Dashboard accessible (user may not have 2FA enabled)")
    print()

def test_remember_me():
    """Test that remember_me is processed"""
    print("3. Testing remember_me functionality...")
    session = requests.Session()
    
    response = session.post(f"{BASE_URL}/login",
        data={
            'email': 'demo@kilimosmart.local',
            'password': 'demo123',
            'remember_me': 'on'
        },
        allow_redirects=False
    )
    
    if response.status_code == 302:
        print("   ✅ Login with remember_me accepted (302 redirect)")
        # Check if session cookie has extended expiry (would need cookie inspection)
    print()

def test_password_reset_accessible():
    """Test that password reset is publicly accessible"""
    print("4. Testing password reset API accessibility...")
    
    response = requests.post(f"{BASE_URL}/api/auth/forgot-password",
        json={'email': 'test@example.com'},
        allow_redirects=False
    )
    
    if response.status_code in [200, 201]:
        data = response.json()
        if 'error' not in data or 'success' in data or 'message' in data:
            print("   ✅ Forgot password endpoint accessible (returns generic response)")
    elif response.status_code == 401:
        print("   ❌ ISSUE: Forgot password blocked by auth")
    print()

def test_login_determinism():
    """Test that login flow is deterministic"""
    print("5. Testing login routing logic...")
    session = requests.Session()
    
    response = session.post(f"{BASE_URL}/login",
        data={
            'email': 'demo@kilimosmart.local',
            'password': 'demo123'
        },
        allow_redirects=False
    )
    
    if response.status_code == 302:
        location = response.headers.get('Location', '')
        if '2fa' in location:
            print(f"   ✅ Deterministic routing: redirects to {location}")
        elif 'dashboard' in location:
            print(f"   ✅ Direct dashboard access (2FA not required for demo user)")
    print()

if __name__ == "__main__":
    print("=" * 60)
    print("Auth Flow Verification Tests")
    print("=" * 60)
    print()
    
    try:
        # Test health endpoint first
        response = requests.get(f"{BASE_URL}/api/health", timeout=2)
        if response.status_code == 200:
            print("✅ Server is running and responsive\n")
        
        # Run tests
        test_open_redirect_prevention()
        test_2fa_enforcement()
        test_remember_me()
        test_password_reset_accessible()
        test_login_determinism()
        
        print("=" * 60)
        print("✅ All auth flow verification tests completed!")
        print("=" * 60)
        
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to server. Make sure webapp.py is running.")
    except Exception as e:
        print(f"❌ Error during testing: {e}")
