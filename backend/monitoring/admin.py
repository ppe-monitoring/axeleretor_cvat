from django.contrib import admin
from .models import Camera, Zone, PPERule, VideoFile, Violation, Employee


class PPERuleInline(admin.TabularInline):
    model = PPERule
    extra = 1


@admin.register(Zone)
class ZoneAdmin(admin.ModelAdmin):
    inlines = [PPERuleInline]


admin.site.register(PPERule)
for m in (Camera, VideoFile, Violation, Employee):
    admin.site.register(m)