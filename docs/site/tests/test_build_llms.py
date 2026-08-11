import pytest

from build_llms import (
    GenerationError,
    NavEntry,
    Page,
    copy_pages,
    find_unlisted,
    generate,
    flatten_nav,
    load_page,
    read_description,
    render_llms_txt,
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


def test_render_llms_txt_groups_pages_under_their_sections():
    pages = [
        Page(
            section="Overview",
            title="Overview",
            doc_path="index.md",
            description="What this thing is.",
        ),
        Page(
            section="Get started",
            title="Install & run",
            doc_path="get-started/install.md",
            description="How to run it.",
        ),
        Page(
            section="Get started",
            title="Your first mock endpoint",
            doc_path="get-started/first-mock.md",
            description="Add an endpoint step by step.",
        ),
    ]

    rendered = render_llms_txt(
        site_name="Mock Server",
        site_description="A data-driven mock server.",
        site_url="https://example.test",
        pages=pages,
    )

    assert rendered == (
        "# Mock Server\n"
        "\n"
        "> A data-driven mock server.\n"
        "\n"
        "## Overview\n"
        "- [Overview](https://example.test/index.md): What this thing is.\n"
        "\n"
        "## Get started\n"
        "- [Install & run](https://example.test/get-started/install.md): How to run it.\n"
        "- [Your first mock endpoint](https://example.test/get-started/first-mock.md): "
        "Add an endpoint step by step.\n"
    )


def test_render_llms_txt_tolerates_a_trailing_slash_in_site_url():
    pages = [
        Page(
            section="Overview",
            title="Overview",
            doc_path="index.md",
            description="What this thing is.",
        )
    ]

    rendered = render_llms_txt("S", "D", "https://example.test/", pages)

    assert "(https://example.test/index.md)" in rendered


def test_copy_pages_mirrors_the_source_tree_verbatim(tmp_path):
    docs_dir = tmp_path / "docs"
    output_dir = tmp_path / "site"
    output_dir.mkdir()
    write_page(docs_dir, "sdk/junit.md", description="D.", body="# JUnit\n\nBody.\n")
    pages = [
        Page(
            section="Testing SDKs",
            title="JUnit 5 guide",
            doc_path="sdk/junit.md",
            description="D.",
        )
    ]

    copy_pages(pages, docs_dir, output_dir)

    copied = output_dir / "sdk" / "junit.md"
    assert copied.read_text(encoding="utf-8") == (
        '---\ndescription: "D."\n---\n\n# JUnit\n\nBody.\n'
    )


def build_site_root(tmp_path, nav_toml, pages):
    """Assemble a fake docs/site/ with a zensical.toml, docs/, and site/."""
    site_root = tmp_path / "site_root"
    docs_dir = site_root / "docs"
    (site_root / "site").mkdir(parents=True)
    for rel_path, description in pages:
        write_page(docs_dir, rel_path, description=description)
    (site_root / "zensical.toml").write_text(
        "[project]\n"
        'site_name = "Mock Server"\n'
        'site_description = "A data-driven mock server."\n'
        'site_url = "https://example.test"\n'
        f"nav = {nav_toml}\n",
        encoding="utf-8",
    )
    return site_root


def test_generate_writes_llms_txt_and_the_mirrored_pages(tmp_path):
    site_root = build_site_root(
        tmp_path,
        nav_toml='[ { "Overview" = "index.md" }, '
        '{ "Reference" = [ { "Configuration" = "reference/configuration.md" } ] } ]',
        pages=[
            ("index.md", "What this is."),
            ("reference/configuration.md", "Env vars."),
        ],
    )

    assert generate(site_root) == 2

    output = site_root / "site"
    assert (output / "index.md").is_file()
    assert (output / "reference" / "configuration.md").is_file()
    assert (output / "llms.txt").read_text(encoding="utf-8") == (
        "# Mock Server\n"
        "\n"
        "> A data-driven mock server.\n"
        "\n"
        "## Overview\n"
        "- [Overview](https://example.test/index.md): What this is.\n"
        "\n"
        "## Reference\n"
        "- [Configuration](https://example.test/reference/configuration.md): Env vars.\n"
    )


def test_generate_raises_when_a_page_is_missing_from_nav(tmp_path):
    site_root = build_site_root(
        tmp_path,
        nav_toml='[ { "Overview" = "index.md" } ]',
        pages=[("index.md", "What this is."), ("stray.md", "Not in nav.")],
    )

    with pytest.raises(GenerationError, match="stray.md"):
        generate(site_root)


def test_generate_raises_when_the_build_output_is_absent(tmp_path):
    site_root = build_site_root(
        tmp_path,
        nav_toml='[ { "Overview" = "index.md" } ]',
        pages=[("index.md", "What this is.")],
    )
    (site_root / "site").rmdir()

    with pytest.raises(GenerationError, match="zensical build"):
        generate(site_root)
