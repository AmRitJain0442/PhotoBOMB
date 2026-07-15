from darkroom_analysis import cache


def test_roundtrip(tmp_path):
    cache.put(tmp_path, "abc123", "vision", {"score": 7})
    assert cache.get(tmp_path, "abc123", "vision") == {"score": 7}


def test_miss(tmp_path):
    assert cache.get(tmp_path, "missing", "vision") is None


def test_namespaces_isolated(tmp_path):
    cache.put(tmp_path, "k", "vision", {"a": 1})
    assert cache.get(tmp_path, "k", "audio") is None


def test_file_key_stable(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"hello")
    k1 = cache.file_key(str(p))
    k2 = cache.file_key(str(p))
    assert k1 == k2
    assert len(k1) == 64  # sha256 hex
    p.write_bytes(b"other")
    assert cache.file_key(str(p)) != k1
