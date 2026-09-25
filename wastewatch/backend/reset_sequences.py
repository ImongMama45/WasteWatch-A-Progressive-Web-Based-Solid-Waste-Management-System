import os
import django
from io import StringIO
from django.core.management import call_command
from django.db import connection

def run():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
    django.setup()
    
    apps = ['accounts', 'watcher', 'driver', 'dumpsite', 'news', 'analytics', 'notifications']
    out = StringIO()
    
    print("Generating sequence reset SQL...")
    call_command('sqlsequencereset', *apps, stdout=out, no_color=True)
    sql = out.getvalue()
    
    if not sql.strip():
        print("No sequences to reset.")
        return
        
    print("Executing SQL...")
    with connection.cursor() as cursor:
        cursor.execute(sql)
        
    print("Sequences reset successfully!")

if __name__ == '__main__':
    run()
