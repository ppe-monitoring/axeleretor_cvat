from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (CameraSummaryViewSet, CameraViewSet, PPERuleViewSet,
                    VideoFileViewSet, ViolationViewSet, ZoneViewSet)

router = DefaultRouter()
router.register("cameras", CameraViewSet, basename="camera")
router.register("zones", ZoneViewSet, basename="zone")
router.register("ppe-rules", PPERuleViewSet, basename="ppe-rule")
router.register("videos", VideoFileViewSet, basename="video")
router.register("violations", ViolationViewSet, basename="violation")
router.register("summaries", CameraSummaryViewSet, basename="summary")

urlpatterns = [path("", include(router.urls))]