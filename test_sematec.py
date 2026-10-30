import unittest, tempfile
from pathlib import Path
import servidor as app

class SmokeTests(unittest.TestCase):
 def test_password(self):
  hashed=app.pw('ClaveRobustaDePrueba!')
  self.assertTrue(app.verify('ClaveRobustaDePrueba!', hashed))
  self.assertFalse(app.verify('OtraClave', hashed))
 def test_html_escaping(self):
  self.assertEqual(app.esc('<script>'), '&lt;script&gt;')
 def test_initialization(self):
  orig=app.DB
  with tempfile.TemporaryDirectory() as tmp:
   app.DB=Path(tmp)/'test.sqlite3'
   try:
    app.init()
    with app.db() as c:
     self.assertEqual(c.execute('select count(*) from courses').fetchone()[0],3)
     self.assertEqual(c.execute('select count(*) from users').fetchone()[0],1)
     self.assertEqual(c.execute('select v from settings where k="name"').fetchone()[0], 'INSTITUTO SEMATEC')
   finally:app.DB=orig

if __name__=='__main__':unittest.main()
