from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Camera, PPERule, Violation, Zone


class ViolationApiTests(APITestCase):
    url = "/api/violations/"

    def setUp(self):
        self.camera = Camera.objects.create(name="Cam 1")
        self.zone = Zone.objects.create(camera=self.camera, name="Цех")
        PPERule.objects.create(zone=self.zone, code="NO_HELMET")
        self.t0 = timezone.now()

    def event(self, seconds=0, **extra):
        data = {
            "camera_id": self.camera.id,
            "frame_number": seconds * 10,
            "timestamp": (self.t0 + timedelta(seconds=seconds)).isoformat(),
            "bbox": [100, 100, 300, 500],
            "confidence": 0.9,
            "violations": ["NO_HELMET"],
        }
        data.update(extra)
        return data

    def post(self, data):
        return self.client.post(self.url, data, format="json")

    def test_create(self):
        r = self.post(self.event())
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Violation.objects.count(), 1)

    def test_merge_within_gap(self):
        self.post(self.event(0))
        r = self.post(self.event(2))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Violation.objects.count(), 1)
        self.assertEqual(Violation.objects.get().frames_count, 2)

    def test_new_incident_after_gap(self):
        self.post(self.event(0))
        self.post(self.event(10))
        self.assertEqual(Violation.objects.count(), 2)

    def test_bad_bbox(self):
        self.assertEqual(self.post(self.event(bbox=[300, 300, 100, 100])).status_code, 400)

    def test_bad_confidence(self):
        self.assertEqual(self.post(self.event(confidence=1.5)).status_code, 400)

    def test_code_not_required_in_zone(self):
        self.assertEqual(self.post(self.event(violations=["NO_VEST"])).status_code, 400)

    def test_unknown_camera(self):
        self.assertEqual(self.post(self.event(camera_id=9999)).status_code, 400)

    def test_batch_with_bad_frame(self):
        r = self.post([self.event(0), self.event(1, bbox=[1, 2])])
        self.assertEqual(r.status_code, 207)
        self.assertEqual(r.data["saved"], 1)
        self.assertEqual(r.data["rejected"], 1)