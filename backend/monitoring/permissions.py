import secrets

from django.conf import settings
from rest_framework.permissions import BasePermission


class MLApiKey(BasePermission):
    """POST от ML: заголовок X-API-Key. Если ML_API_KEY пуст, проверка выключена."""

    def has_permission(self, request, view):
        key = getattr(settings, "ML_API_KEY", "")
        if not key:
            return True
        return secrets.compare_digest(request.headers.get("X-API-Key", ""), key)