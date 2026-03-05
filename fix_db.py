#!/usr/bin/env python3
import sqlite3
import os

db_path = "instance/kilimosmart.db"
if not os.path.exists(db_path):
    print(f"Database file not found: {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    # Add missing columns for password reset functionality
    cursor.execute("ALTER TABLE user ADD COLUMN reset_token_hash VARCHAR(255)")
    print("Added reset_token_hash column")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e):
        print("reset_token_hash column already exists")
    else:
        print(f"Error adding reset_token_hash: {e}")

try:
    cursor.execute("ALTER TABLE user ADD COLUMN reset_token_expires_at DATETIME")
    print("Added reset_token_expires_at column")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e):
        print("reset_token_expires_at column already exists")
    else:
        print(f"Error adding reset_token_expires_at: {e}")

conn.commit()
conn.close()
print("Database schema updated successfully!")
