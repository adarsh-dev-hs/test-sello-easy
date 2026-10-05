from datetime import datetime, timedelta, timezone

from app.pipelines import scoring

ICP = {
    "firmographics": {
        "industries": ["Manufacturing", "Ports & Logistics", "Mining"],
        "employee_range": "1000+",
        "geographies": ["Europe", "Netherlands", "Germany", "Canada"],
    },
    "personas": [{"title": "VP Operations"}, {"title": "Head of OT"}, {"title": "CIO"}],
}


def test_dedupe_key_prefers_domain_and_normalises_names():
    assert scoring.dedupe_key("Harborline Ports B.V.", "https://www.harborline-ports.example/about") == (
        "harborline-ports.example"
    )
    assert scoring.dedupe_key("Ostrava Steelworks a.s.", None) == scoring.dedupe_key("ostrava steelworks", None)
    assert scoring.dedupe_key("Acme Inc.", None) == "acme"
    assert scoring.dedupe_key(None, None) is None


def test_parse_range():
    assert scoring.parse_range("200-2,000 employees") == (200, 2000)
    assert scoring.parse_range("1000+") == (1000, None)
    assert scoring.parse_range("5k to 10k") == (5000, 10000)
    assert scoring.parse_range(None) == (None, None)


def test_fit_score_rewards_matching_firmographics():
    good, reasons = scoring.fit_score(
        {"industry": "Manufacturing", "employees": 4000, "hq": "Germany", "contact_title": "Head of OT", "llm_fit": "strong"},
        ICP,
    )
    bad, _ = scoring.fit_score(
        {"industry": "Retail", "employees": 20, "hq": "Brazil", "contact_title": "Store clerk", "llm_fit": "weak"},
        ICP,
    )
    assert good == 100.0
    assert bad < 20
    assert any("matches ICP" in r for r in reasons)


def test_fit_score_falls_back_to_llm_when_unknown():
    score, _ = scoring.fit_score({"llm_fit": "medium"}, ICP)
    assert score == 60.0


def test_intent_score_decays_and_rewards_signal_diversity():
    now = datetime.now(timezone.utc)
    fresh = [{"weight": 1.0, "confidence": 1.0, "published_at": now, "type": "hiring", "name": "Hiring"}]
    old = [{"weight": 1.0, "confidence": 1.0, "published_at": now - timedelta(days=60), "type": "hiring"}]
    multi = fresh + [{"weight": 0.5, "confidence": 0.5, "published_at": now, "type": "expansion"}]
    assert scoring.intent_score(fresh, now)[0] == 100.0
    assert scoring.intent_score(old, now)[0] < 10
    assert scoring.intent_score(multi, now)[0] == 100.0
    assert scoring.intent_score([], now) == (0.0, [])
    assert scoring.total_score(80, 60) == 70


def test_geo_regions_expand_to_countries():
    icp = {"firmographics": {"geographies": ["North America", "Nordics"]}, "personas": []}
    fit_in, reasons = scoring.fit_score({"hq": "Sudbury, Ontario, Canada"}, icp)
    assert any("HQ" in r and "matches ICP" in r for r in reasons)
    _, reasons_out = scoring.fit_score({"hq": "Sao Paulo, Brazil"}, icp)
    assert any("HQ" in r and "outside ICP" in r for r in reasons_out)
