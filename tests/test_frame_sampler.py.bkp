"""Tests for frame sampler."""

import numpy as np

from cookie.edge.frame_sampler import FrameSampler


def test_first_frame_always_sent():
    sampler = FrameSampler({"phash_threshold": 12, "min_interval_ms": 0})
    frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
    should, hash_hex = sampler.should_send(frame)
    assert should is True
    assert len(hash_hex) > 0


def test_identical_frame_not_sent():
    sampler = FrameSampler({"phash_threshold": 12, "min_interval_ms": 0})
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    sampler.should_send(frame)  # first always sent
    should, _ = sampler.should_send(frame)
    assert should is False


def test_different_frame_sent():
    sampler = FrameSampler({"phash_threshold": 5, "min_interval_ms": 0})
    frame1 = np.zeros((480, 640, 3), dtype=np.uint8)
    # Create a frame with strong visual structure difference (not just brightness)
    frame2 = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
    sampler.should_send(frame1)
    should, _ = sampler.should_send(frame2)
    assert should is True


def test_jpeg_encode():
    sampler = FrameSampler()
    frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
    jpeg = sampler.encode_jpeg(frame)
    assert len(jpeg) > 0
    assert jpeg[:2] == b'\xff\xd8'  # JPEG magic bytes
