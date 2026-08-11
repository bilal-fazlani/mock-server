import pytest

from build_llms import GenerationError, NavEntry, flatten_nav


def test_flatten_nav_preserves_section_grouping_and_order():
    nav = [
        {"Overview": "index.md"},
        {
            "Get started": [
                {"Install & run": "get-started/install.md"},
                {"Your first mock endpoint": "get-started/first-mock.md"},
            ]
        },
    ]

    assert flatten_nav(nav) == [
        NavEntry(section="Overview", title="Overview", doc_path="index.md"),
        NavEntry(
            section="Get started",
            title="Install & run",
            doc_path="get-started/install.md",
        ),
        NavEntry(
            section="Get started",
            title="Your first mock endpoint",
            doc_path="get-started/first-mock.md",
        ),
    ]


def test_flatten_nav_rejects_three_level_nesting():
    nav = [{"Reference": [{"Deeper": [{"Page": "a.md"}]}]}]

    with pytest.raises(GenerationError, match="two levels"):
        flatten_nav(nav)


def test_flatten_nav_rejects_multi_key_entry():
    nav = [{"One": "one.md", "Two": "two.md"}]

    with pytest.raises(GenerationError, match="exactly one key"):
        flatten_nav(nav)
