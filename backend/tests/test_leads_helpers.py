from app.pipelines.leads import _quote_in_text

TEXT = "Senior Accountant – NetSuite ERP Migration at Pinecrest Foods (Mississauga). Help us move AP to NetSuite."


def test_quote_must_appear_in_hit():
    assert _quote_in_text("NetSuite ERP Migration at Pinecrest Foods", TEXT)
    assert _quote_in_text("netsuite erp migration, at Pinecrest foods!", TEXT)  # punctuation/case-insensitive
    assert not _quote_in_text("hiring a Head of OT for the plant network", TEXT)  # hallucinated
    assert not _quote_in_text("", TEXT)
    assert not _quote_in_text("AP", TEXT)  # too short to be evidence
