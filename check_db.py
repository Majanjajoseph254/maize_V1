#!/usr/bin/env python3
import sqlite3
import os

db_path = "instance/kilimosmart.db"
if not os.path.exists(db_path):
    print(f"Database file not found: {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()
print(f"Tables in database: {tables}\n")

# Get user table schema
if tables:
    cursor.execute("PRAGMA table_info(user)")
    columns = cursor.fetchall()
    print("User table columns:")
    for col in columns:
        print(f"  {col}")
else:
    print("No tables found in database!")

conn.close()
