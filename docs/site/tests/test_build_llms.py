import pytest

from build_llms import (
    GenerationError,
    NavEntry,
    Page,
    find_unlisted,
    flatten_nav,
    load_page,
    read_description,
)


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


def write_page(docs_dir, rel_path, description="A description.", body="# Title\n"):
    """Write a fixture page. Pass description=None to omit the front matter."""
    path = docs_dir / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    front = "" if description is None else f'---\ndescription: "{description}"\n---\n\n'
    path.write_text(front + body, encoding="utf-8")
    return path


def test_read_description_returns_the_front_matter_value(tmp_path):
    path = write_page(tmp_path, "a.md", description="What the page covers.")

    assert read_description(path) == "What the page covers."


def test_read_description_returns_none_without_front_matter(tmp_path):
    path = write_page(tmp_path, "a.md", description=None)

    assert read_description(path) is None


def test_read_description_returns_none_when_the_key_is_absent(tmp_path):
    path = tmp_path / "a.md"
    path.write_text("---\ntitle: Something\n---\n\n# Title\n", encoding="utf-8")

    assert read_description(path) is None


def test_load_page_carries_the_description(tmp_path):
    write_page(tmp_path, "sdk/junit.md", description="The Jupiter extension.")
    entry = NavEntry(
        section="Testing SDKs", title="JUnit 5 guide", doc_path="sdk/junit.md"
    )

    assert load_page(entry, tmp_path) == Page(
        section="Testing SDKs",
        title="JUnit 5 guide",
        doc_path="sdk/junit.md",
        description="The Jupiter extension.",
    )


def test_load_page_raises_when_the_file_is_missing(tmp_path):
    entry = NavEntry(section="Reference", title="Gone", doc_path="reference/gone.md")

    with pytest.raises(GenerationError, match="missing page"):
        load_page(entry, tmp_path)


def test_load_page_raises_when_the_description_is_missing(tmp_path):
    write_page(tmp_path, "a.md", description=None)
    entry = NavEntry(section="Overview", title="Overview", doc_path="a.md")

    with pytest.raises(GenerationError, match="description"):
        load_page(entry, tmp_path)


def test_find_unlisted_reports_pages_absent_from_nav(tmp_path):
    write_page(tmp_path, "a.md")
    write_page(tmp_path, "nested/orphan.md")
    entries = [NavEntry(section="Overview", title="A", doc_path="a.md")]

    assert find_unlisted(tmp_path, entries) == ["nested/orphan.md"]


def test_find_unlisted_is_empty_when_nav_covers_everything(tmp_path):
    write_page(tmp_path, "a.md")
    entries = [NavEntry(section="Overview", title="A", doc_path="a.md")]

    assert find_unlisted(tmp_path, entries) == []
