from django.apps import AppConfig

class DriverConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'driver'
    verbose_name = 'Driver Management'

    def ready(self):
        import driver.signals  # noqa: F401 — registers pre_delete receiver
