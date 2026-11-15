from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Camera, PPERule, Violation, Zone


@override_settings(ML_API_KEY="")
class ViolationApiTests(APITestCase):
    url = "/api/violations/"

    def setUp(self):
        self.camera = Camera.objects.create(name="Cam 1")
        self.zone = Zone.objects.create(camera=self.camera, name="Цех")
        PPERule.objects.create(zone=self.zone, code="NO_HELMET")
        PPERule.objects.create(zone=self.zone, code="NO_VEST")
        self.t0 = timezone.now()

    def event(self, seconds=0, **extra):
        data = {
            "camera_id": self.camera.id,
            "track_id": 1,
            "frame_number": seconds * 10,
            "timestamp": (self.t0 + timedelta(seconds=seconds)).isoformat(),
            "bbox": [100, 100, 300, 500],
            "violations": [{"code": "NO_HELMET", "confidence": 0.9}],
        }
        data.update(extra)
        return data

    def post(self, data, **kw):
        return self.client.post(self.url, data, format="json", **kw)

    def test_create(self):
        r = self.post(self.event())
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Violation.objects.count(), 1)

    def test_merge_within_gap(self):
        self.post(self.event(0))
        r = self.post(self.event(2))
        self.assertEqual(r.status_code, 200)
        v = Violation.objects.get()
        self.assertEqual(v.frames_count, 2)

    def test_new_incident_after_gap(self):
        self.post(self.event(0))
        self.post(self.event(10))
        self.assertEqual(Violation.objects.count(), 2)

    def test_different_track_not_merged(self):
        self.post(self.event(0, track_id=1))
        self.post(self.event(1, track_id=2))
        self.assertEqual(Violation.objects.count(), 2)

    def test_two_codes_two_incidents(self):
        ev = self.event(violations=[{"code": "NO_HELMET", "confidence": 0.9},
                                    {"code": "NO_VEST", "confidence": 0.8}])
        self.post(ev)
        self.assertEqual(Violation.objects.count(), 2)

    def test_max_confidence_kept(self):
        self.post(self.event(0, violations=[{"code": "NO_HELMET", "confidence": 0.6}]))
        self.post(self.event(1, violations=[{"code": "NO_HELMET", "confidence": 0.95}]))
        self.assertEqual(Violation.objects.get().confidence, 0.95)

    def test_duplicate_event_id(self):
        self.post(self.event(event_id="e1"))
        r = self.post(self.event(event_id="e1"))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["results"][0]["duplicate"])
        self.assertEqual(Violation.objects.get().frames_count, 1)

    def test_out_of_order_batch_merged(self):
        r = self.post([self.event(2), self.event(0)])
        self.assertEqual(r.status_code, 201)
        v = Violation.objects.get()
        self.assertEqual(v.frames_count, 2)
        self.assertEqual(v.timestamp, self.t0)

    def test_bad_bbox(self):
        self.assertEqual(self.post(self.event(bbox=[300, 300, 100, 100])).status_code, 400)

    def test_bad_confidence(self):
        ev = self.event(violations=[{"code": "NO_HELMET", "confidence": 1.5}])
        self.assertEqual(self.post(ev).status_code, 400)

    def test_code_not_required_in_zone(self):
        ev = self.event(violations=[{"code": "NO_GLOVES", "confidence": 0.9}])
        self.assertEqual(self.post(ev).status_code, 400)

    def test_unknown_camera(self):
        self.assertEqual(self.post(self.event(camera_id=9999)).status_code, 400)

    def test_batch_with_bad_frame(self):
        r = self.post([self.event(0), self.event(1, bbox=[1, 2])])
        self.assertEqual(r.status_code, 207)
        self.assertEqual(r.data["saved"], 1)
        self.assertEqual(r.data["rejected"], 1)

    def test_status_patch(self):
        self.post(self.event())
        v = Violation.objects.get()
        r = self.client.patch(f"{self.url}{v.id}/", {"status": "confirmed"}, format="json")
        self.assertEqual(r.status_code, 200)
        v.refresh_from_db()
        self.assertEqual(v.status, "confirmed")

    @override_settings(ML_API_KEY="secret")
    def test_api_key_required(self):
        self.assertEqual(self.post(self.event()).status_code, 403)
        r = self.post(self.event(), HTTP_X_API_KEY="secret")
        self.assertEqual(r.status_code, 201)


@override_settings(ML_API_KEY="")
class SummaryApiTests(APITestCase):
    def setUp(self):
        self.camera = Camera.objects.create(name="Cam 1")

    def test_summary_sets_ml_online(self):
        r = self.client.get("/api/cameras/")
        self.assertFalse(r.data["results"][0]["ml_online"])
        r = self.client.post("/api/summaries/", {
            "camera": self.camera.id, "people_checked": 10, "violators": 2}, format="json")
        self.assertEqual(r.status_code, 201)
        r = self.client.get("/api/cameras/")
        self.assertTrue(r.data["results"][0]["ml_online"])

    def test_violators_more_than_checked(self):
        r = self.client.post("/api/summaries/", {
            "camera": self.camera.id, "people_checked": 1, "violators": 5}, format="json")
        self.assertEqual(r.status_code, 400)