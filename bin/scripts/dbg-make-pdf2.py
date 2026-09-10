import os
import fitz

os.makedirs("C:/Users/aKris/AppData/Local/Temp/opencode", exist_ok=True)

# 1. Normal university-style syllabus (unicode included)
d = fitz.open()
d.new_page().insert_text((72, 72), "UNIT I: Introduction — Data Structures\n\u00c9tude des tableaux\n1. Arrays\n2. Linked Lists")
d.new_page().insert_text((72, 72), "UNIT II: Normalisation des bases\nKeys and constraints")
d.save("C:/Users/aKris/AppData/Local/Temp/opencode/uni.pdf")
print("uni.pdf ok")

# 2. Password-protected PDF
e = fitz.open()
e.new_page().insert_text((72, 72), "UNIT I: Secret content")
e.save("C:/Users/aKris/AppData/Local/Temp/opencode/locked.pdf", encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="test123")
print("locked.pdf ok")

# 3. Garbage bytes with .pdf extension
with open("C:/Users/aKris/AppData/Local/Temp/opencode/garbage.pdf", "wb") as f:
    f.write(b"This is definitely not a PDF file at all, just text.")
print("garbage.pdf ok")
