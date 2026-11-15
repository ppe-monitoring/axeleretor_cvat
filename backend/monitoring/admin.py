from django.contrib import admin
from .models import (Camera, Zone, PPERule, VideoFile, Violation, Employee,
                     ProcessedEvent, CameraSummary)


class PPERuleInline(admin.TabularInline):
    model = PPERule
    extra = 1


@admin.register(Zone)
class ZoneAdmin(admin.ModelAdmin):
    inlines = [PPERuleInline]


@admin.register(Violation)
class ViolationAdmin(admin.ModelAdmin):
    list_display = ("id", "camera", "code", "track_id", "timestamp", "ended_at", "frames_count", "status")
    list_filter = ("status", "code", "camera")


admin.site.register(PPERule)
for m in (Camera, VideoFile, Employee, ProcessedEvent, CameraSummary):
    admin.site.register(m)