from django.core.management.base import BaseCommand
from monitoring.models import Camera, Zone, PPERule, Employee


class Command(BaseCommand):
    help = "Создать тестовые данные: камеру, зону с правилами, сотрудника"

    def handle(self, *args, **opts):
        cam, _ = Camera.objects.get_or_create(name="Cam 1", defaults={"location": "Цех 1"})
        zone, _ = Zone.objects.get_or_create(camera=cam, name="Цех")
        for code in ("NO_HELMET", "NO_VEST"):
            PPERule.objects.get_or_create(zone=zone, code=code)
        Employee.objects.get_or_create(
            external_id="E-001", defaults={"full_name": "Тестовый Сотрудник", "position": "Монтажник"})
        self.stdout.write(self.style.SUCCESS(
            f"Готово: camera_id={cam.id}, zone_id={zone.id}, правила: NO_HELMET, NO_VEST"))