// Runs release-please's own Conventional-Commits parser over a range of commit messages and
// fails if any of them cannot be parsed, or if the parse it gets is not the one the author meant.
//
// Why this exists: release-please parses every commit it considers for a release with
// `@conventional-commits/parser`, and when that parser throws it *catches the error, logs a debug
// line and moves on*. The commit is then simply absent from the release PR - no failure, no
// annotation, a green run and a changelog that is quietly missing an entry. That is exactly what
// happens to a commit whose body has a column-one `Word: value` line or a `foo(bar(baz))` line. This
// check turns that silent drop into a loud one at pull-request time.
//
// The parser has a second silent mode, and it does not throw at all. A footer is tried at the
// start of every body line, so any line beginning in column one with `Word: value` is lifted out
// of the body and read as a *footer* - taking the rest of the message with it. Two ways that goes
// wrong, both of them real rather than imagined:
//
//   * the word is `BREAKING CHANGE`, and a sentence nobody meant as a footer turns a `fix:` into
//     a major version bump of a published release, which cannot be taken back;
//   * the word is anything else - `hypothetical:`, `spring-test:` after a paragraph rewrap - and
//     the tail of the body silently disappears from the changelog entry.
//
// Both are checked below, in `auditFooters`, along with a third thing a footer can do that has
// nothing to do with release-please: `Closes #29` is a formal issue-closing link, and GitHub acts
// on it the moment the commit reaches the default branch - closing the issue and moving its card
// past the review gate before anyone has signed the work off. This repo writes `Refs #<n>`
// instead, and that rule is now enforced here rather than remembered.
//
// It deliberately imports the same package, at the same version release-please resolves, rather
// than any other Conventional-Commits linter: a more tolerant parser would happily accept the
// very messages release-please rejects, which is worse than having no check at all. For the same
// reason, the question "is this footer an issue reference?" is put back to the library rather
// than answered with a regex of our own.
//
// Usage:
//   node check.mjs <base-sha> <head-sha>   check every non-merge commit in base..head
//   node check.mjs <range>                 same, given a single "a..b" revision range
//   node check.mjs                         defaults to HEAD~1..HEAD
//   node check.mjs --self-test             assert the parser still rejects/accepts what we expect
//
// Add --strict, or run with GITHUB_EVENT_NAME=pull_request (which Actions sets for us), to treat
// "there is no range to check" as a failure rather than a pass. A pull request always has a
// resolvable base and always adds at least one non-merge commit, so on that leg an unresolvable
// base or an empty range means the check is in a state it does not understand - and reporting
// that as success would be the same manufactured confidence this whole guard exists to prevent.
// The degraded head-only fallback stays available for the push leg, where `github.event.before`
// really can be unusable after a force-push or on branch creation, but it announces itself.

import {execFileSync} from 'node:child_process';
import {parser, toConventionalChangelogFormat} from '@conventional-commits/parser';

const ZERO_SHA = '0000000000000000000000000000000000000000';

function git(...args) {
  return execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
}

// Mirrors release-please's own `parseCommits`: parse, then convert. Both halves can throw, and
// release-please swallows either one identically, so both are on the hook here. The syntax tree
// is handed back because the footer audit needs it - the changelog format has already discarded
// the evidence, which is the whole problem.
function parseLikeReleasePlease(message) {
  const ast = parser(message);
  toConventionalChangelogFormat(ast);
  return ast;
}

// A construct that makes the parser throw. `<token> "(" <scope> ")"` is legal in a *footer*, and
// the parser tries a footer at the start of every body line, so a body line that begins in column
// one with something like `foo(bar(baz))` sends it into its scope rule. That rule consumes up to
// the next paren or newline and then hard-throws - not a recoverable "this is body text after
// all" - if what it finds is anything other than the closing paren. Recognising the shape here
// lets the failure be explained rather than merely reported.
function diagnose(line) {
  // The parser's <type> rule ends at the first paren, whitespace, newline, "!" or ":"; only a
  // "(" there takes it into the scope rule that throws.
  const open = line.search(/[\s():!]/);
  if (open < 0 || line[open] !== '(' || open === 0) return null;
  const rest = line.slice(open + 1);
  const close = rest.search(/[()]/);
  if (close < 0) {
    return `line begins with \`${line.slice(0, open + 1)}\` and no \`)\` closes it before the ` +
      'end of the line, so the parser reads the rest of the line as a footer scope.';
  }
  if (rest[close] === '(') {
    return `line begins with \`${line.slice(0, open + 1)}\` and the next paren inside it is ` +
      'another `(`, which the parser is reading as a nested footer scope.';
  }
  return null;
}

const REMEDY = [
  'Fix: indent the line by one space, reflow the paragraph so the construct does not start in',
  'column one, or drop the outer parentheses. Only a line starting in column one can be read as',
  'a footer - the same text one space in, or mid-line, parses fine.',
].join('\n  ');

// Footer tokens taken at face value, whatever they carry. Both are trailers git and GitHub
// generate mechanically rather than sentences an author types into a paragraph, and the standard
// remedy below would be actively wrong for them: an indented `Co-authored-by` is no longer a
// co-author. Note who is *not* here - `Refs`, this repo's own footer. An unconditional pass would
// let `Refs: the docs page for X explains the rest` through under the token this repo writes most,
// which is the absorbed-prose case walking in the front door. All 30 uses in this history are
// exactly `Refs #<n>`, which the reference test below already accepts on its own merits.
const ALLOWED_FOOTER_TOKENS = new Set(['co-authored-by', 'signed-off-by']);

// Every other footer has to earn its place by resolving to an issue reference, and the library
// itself is the judge - the same instance release-please uses, asked the same question, rather
// than a regex of ours guessing at its rules. That is what keeps `Refs #32` off the failure list
// without an allowlist of blessed reference verbs.
//
// This hatch used to admit `Closes #29` too, on the same ground: it is a reference and not
// absorbed prose. That is still true, and it is still not enough - the closing-keyword rule above
// runs first and takes those back out, because the objection to them was never that the parser
// misreads them. The two rules divide the ground rather than overlap: a footer that names an
// issue by a closing verb fails there, a footer that names one any other way passes here, and a
// footer that names no issue at all falls through to the absorbed-prose failure below.
//
// What makes this safe as an escape hatch is that a reference resolves only when the footer's
// value is a single `#<number>` *in its entirety*. Leading position is not enough. Any prose left
// on the line disqualifies it - and prose left on the line is the defining feature of an absorbed
// one. So `see: #32 is fixed`, `Closes #29, #30` and even `Fixes #12.` all resolve to nothing,
// and a line this hatch accepts has no absorbed text left on it to lose.
function isIssueReference(footerText) {
  try {
    const probe = toConventionalChangelogFormat(parser(`chore: probe\n\n${footerText}`));
    return probe.references.length > 0;
  } catch {
    return false;
  }
}

// GitHub's issue-closing keywords, which is a closed set of nine: three verbs in three tenses,
// matched without regard to case. Every other token - `Refs`, `See`, `Part-of` - mentions an
// issue without touching its state, which is the whole point of the house convention.
//
// Verified rather than assumed. The nine are what GitHub documents for "linking a pull request to
// an issue", which says the same keywords apply "in the pull request's description or in a commit
// message", and that a commit message closes the issue when it is merged into the default branch.
// A sweep of closed issues in golang/go and rust-lang/rust whose `closed` event
// names a commit turned up `Fixes`, `fixes`, `fix` and `Closes` doing the same thing there, in
// both the `#<n>` and the `<owner>/<repo>#<n>` spellings, which is what settles the tenses and
// the case-insensitivity as behaviour rather than as documentation.
const CLOSING_KEYWORDS = new Set([
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
]);

// GitHub acts only when the reference follows the keyword directly: `Closes #29`, `Closes: #29`
// and `Closes: owner/repo#29` all close, and so does `Fixes #12.` despite the full stop. A line
// like `fixed: see also #12` closes nothing, and that is the distinction this test draws - it
// keeps the rule off ordinary prose that happens to open with one of the nine words, which is the
// absorbed-footer rule's business below and wants that rule's remedy, not this one's.
//
// Unlike `isIssueReference` this cannot be put back to the library, and the difference is not
// stylistic. The parser resolves a reference only when the value is exactly one `#<number>`, so
// it sees nothing in `Fixes #12.` - while GitHub closes issue 12 on it regardless. The rule has
// to match what closes an issue, not what release-please manages to record.
//
// What bounds it is what the *parser* calls a footer, which is narrower still than what GitHub
// reads. `Closes  #29` with two spaces is not a footer at all and is not seen here; nor is any
// keyword mid-sentence. It is not seen here either way, so the boundary is stated rather than left to be
// discovered.
const CLOSING_REFERENCE = /^[A-Za-z-]+:?[ \t]*(?:[\w.-]+\/[\w.-]+)?#\d+/;

const CLOSING_WHY = [
  'this is a formal issue-closing link. GitHub closes the issue the moment this commit reaches',
  'the default branch, and the project board moves the card with it - past the review gate,',
  'before the work has been signed off, and whether or not the release it belongs to ever ships.',
].join('\n       ');

const CLOSING_REMEDY = [
  'Fix: write `Refs #<number>` instead. It records the same link in the commit and puts the same',
  'reference in the changelog entry, without the side effect: the issue is closed by whoever',
  'accepts the work, and the board card moves when that happens rather than when the commit',
  'lands. The nine words that close are close/closes/closed, fix/fixes/fixed and',
  'resolve/resolves/resolved, in any case; everything else merely references.',
].join('\n  ');

// Some closing footers carry something else as well - a second number in `Closes #29, #30`, a
// full stop in `Fixes #12.` - and swapping the token alone would leave them failing the absorbed
// rule on the next run. Two failures for one line is a remedy that only works on the second
// attempt, which is the standard this check holds itself to elsewhere, so say both at once.
//
// Note what neither remedy says: indent the line. That is the right answer for absorbed prose and
// the wrong one here, because indenting hides the line from the parser while GitHub goes on
// reading it and closing the issue - a green check over a commit that still closes on landing.
const CLOSING_ALSO_ABSORBED_REMEDY = [
  CLOSING_REMEDY,
  'And give the reference a line of its own carrying nothing but `Refs #<number>`: this line has',
  'more on it than one `#<number>`, so changing only the word would leave it failing as prose the',
  'parser absorbed into a footer.',
].join('\n  ');

const BREAKING_WHY = [
  'this line is read as a `BREAKING CHANGE` footer, so release-please computes a MAJOR version',
  'bump from it whatever the subject says. A major release of a published release cannot',
  'be taken back, only superseded, so this repo insists the subject say so too.',
].join('\n       ');

const BREAKING_REMEDY = [
  'Fix, if the break is intended: mark it in the subject as well - `feat(scope)!: ...` - so the',
  'version comes from one authoritative signal instead of two. This is stricter than Conventional',
  'Commits, which accepts the footer alone; the trade is deliberate.',
  'Fix, if it is not intended: the line is prose the parser lifted out of the body. Reword it so',
  'it does not begin `BREAKING CHANGE:` in column one, or indent it by one space.',
].join('\n  ');

const ABSORBED_REMEDY = [
  'Fix: indent the line by one space, or reflow the paragraph so it does not start with a word',
  'followed by `:` or ` #`. Only a line starting in column one can be read as a footer. If the',
  'line is a reference, give it one of its own carrying nothing but `<Token> #<number>`.',
  'Fix, if the footer is genuinely intended: add its token to ALLOWED_FOOTER_TOKENS in',
  '.github/commit-parse-check/check.mjs - but note that release-please surfaces only `BREAKING',
  'CHANGE` notes and `#`-issue references, so any other footer is text nobody downstream sees.',
].join('\n  ');

// `opener` is what the author actually typed to open the footer - the token plus the real
// separator, which is `:` for `hypothetical: prose` but ` #` for `Fixes #12.`. Quoting a colon
// the line does not contain sends an author looking for a construct that is not in their commit.
function footerTokenOf(footer) {
  const token = footer.children.find(child => child.type === 'token');
  const kind = token?.children?.[0];
  if (!kind) return null;
  const separator = footer.children.find(child => child.type === 'separator');
  return {
    breaking: kind.type === 'breaking-change',
    name: kind.value,
    opener: `${kind.value}${separator?.value ?? ''}`,
  };
}

// The non-throwing half of the guard. Walks the footers the parser found and reports the two ways
// a message can parse cleanly and still not mean what it says.
function auditFooters(ast, message) {
  // The tree, not the string. A `!` marks a break only between the type or scope and the
  // separator; anywhere else in the subject it is ordinary punctuation, and `fix: do not panic!`
  // would otherwise excuse a footer-only breaking note it has nothing to do with.
  const subjectMarksBreaking = ast.children
    .find(child => child.type === 'summary')
    ?.children.some(child => child.type === 'breaking-change') === true;
  const problems = [];
  for (const footer of ast.children.filter(child => child.type === 'footer')) {
    const token = footerTokenOf(footer);
    if (!token) continue;
    const {line, column} = footer.position.start;
    const text = message.slice(footer.position.start.offset, footer.position.end.offset);
    if (token.breaking) {
      // A `!` in the subject is release-please's other route to the same note, and it is the one
      // this repo uses. With it present the note is intended by construction, footer or not.
      if (!subjectMarksBreaking) {
        problems.push({rule: 'breaking', line, column, why: BREAKING_WHY, remedy: BREAKING_REMEDY});
      }
      continue;
    }
    // Ahead of the reference hatch below, on purpose and provably: a closing keyword passes that
    // test by construction - which is the whole objection to it - so running this rule after it
    // would leave this rule unreachable. Its position relative to the trailer allowlist is a
    // matter of taste rather than behaviour, and stays a matter of taste only while no closing
    // keyword sits on that allowlist; the self-test asserts exactly that, so the order here
    // cannot start mattering without something going red.
    if (CLOSING_KEYWORDS.has(token.name.toLowerCase()) && CLOSING_REFERENCE.test(text)) {
      problems.push({
        rule: 'closing',
        line,
        column,
        why: CLOSING_WHY,
        // The footer fails the rule below as well when it does not resolve to a reference, and
        // the author should hear that now rather than after acting on half of it.
        remedy: isIssueReference(text) ? CLOSING_REMEDY : CLOSING_ALSO_ABSORBED_REMEDY,
      });
      continue;
    }
    if (ALLOWED_FOOTER_TOKENS.has(token.name.toLowerCase())) continue;
    if (isIssueReference(text)) continue;
    problems.push({
      rule: 'absorbed',
      line,
      column,
      why: [
        `this line opens with \`${token.opener}\` in column one, so the parser reads it as a`,
        'footer token rather than as body text. It is gone from `body`, it reaches no changelog',
        'entry, and it takes the rest of the message with it.',
      ].join('\n       '),
      remedy: ABSORBED_REMEDY,
    });
  }
  return problems;
}

function auditMessage(message) {
  return auditFooters(parseLikeReleasePlease(message), message);
}

// One rewrapped paragraph can produce several absorbed lines at once, so the remedies are printed
// once each after the offending lines rather than repeated under every one of them.
function reportFooters(sha, subject, message, problems) {
  const lines = message.split('\n');
  console.log(`  FAIL ${sha.slice(0, 8)} ${subject}`);
  for (const problem of problems) {
    const prefix = `line ${problem.line}: `;
    console.log(`       ${prefix}${lines[problem.line - 1] ?? ''}`);
    console.log(`       ${' '.repeat(prefix.length + problem.column - 1)}^`);
    console.log(`       ${problem.why}`);
  }
  for (const remedy of new Set(problems.map(problem => problem.remedy))) {
    console.log(`\n  ${remedy}`);
  }
  console.log('');
}

function report(sha, subject, error) {
  const lines = git('log', '-1', '--format=%B', sha).replace(/\n+$/, '').split('\n');
  console.log(`  FAIL ${sha.slice(0, 8)} ${subject}`);
  console.log(`       @conventional-commits/parser: ${error.message}`);
  const at = /at (\d+):(\d+)/.exec(error.message);
  if (at) {
    const line = lines[Number(at[1]) - 1];
    if (line !== undefined) {
      console.log(`       line ${at[1]}: ${line}`);
      console.log(`       ${' '.repeat(`line ${at[1]}: `.length + Number(at[2]) - 1)}^`);
      const why = diagnose(line);
      if (why) console.log(`       ${why}\n\n  ${REMEDY}`);
    }
  }
  console.log('');
}

function selfTest() {
  // A check that cannot fail is worse than no check, and this one's whole value rests on the
  // dependency behaving the way the workflow claims it does. These two fixtures are a minimal
  // reduction of the real failure and of a message differing from it only by one space of
  // indent; if either verdict ever flips, the parser changed underneath us and the guard, the
  // docs and the house commit style all need revisiting.
  const bad = 'fix: s\n\na(b(c))\n';
  const good = 'fix: s\n\n a(b(c))\n';
  let ok = true;
  try {
    parseLikeReleasePlease(bad);
    console.log('self-test FAILED: the parser now accepts a nested-paren body line.');
    ok = false;
  } catch {
    console.log('self-test: nested-paren body line still rejected, as expected.');
  }
  try {
    parseLikeReleasePlease(good);
    console.log('self-test: the same line indented one space still parses, as expected.');
  } catch (e) {
    console.log(`self-test FAILED: an indented body line no longer parses (${e.message}).`);
    ok = false;
  }

  // One fixture per closing keyword, spelled out rather than derived from CLOSING_KEYWORDS. A
  // list generated from the set under test would shrink along with it, so dropping a word would
  // also drop its own witness and the suite would still pass; a set is only as good as its
  // least-tested member. Cases are mixed on purpose - GitHub does not care, and neither may we.
  const closingWords = [
    ['close', 'fix: s\n\nbody\n\nclose #12'],
    ['closes', 'fix: s\n\nbody\n\nCloses #12'],
    ['closed', 'fix: s\n\nbody\n\nCLOSED #12'],
    ['fix', 'fix: s\n\nbody\n\nfix #12'],
    ['fixes', 'fix: s\n\nbody\n\nFixes #12'],
    ['fixed', 'fix: s\n\nbody\n\nFixed #12'],
    ['resolve', 'fix: s\n\nbody\n\nresolve #12'],
    ['resolves', 'fix: s\n\nbody\n\nResolves #12'],
    ['resolved', 'fix: s\n\nbody\n\nRESOLVED #12'],
  ];

  // The footer assertions get the same treatment, in both directions, and each flagged fixture
  // names the rule that has to fire on it rather than merely asserting that something did. Three
  // rules now overlap on the same lines - a closing keyword is also a reference, and a reference
  // that resolves to nothing is also absorbed prose - so "one problem was reported" no longer
  // distinguishes the check working from the check working by accident.
  //
  // The accepted fixtures are real shapes from this history - `feat!:` is 208a6ff, `close the
  // one-shot catalog client` is 20's subject - not invented ones.
  const flagged = [
    ['the issue\'s own case: a `fix:` whose last line reads as a breaking note',
      'fix: s\n\nprose here\n\nBREAKING CHANGE: not really meant as one', ['breaking']],
    ['a breaking note under a subject that carries no `!`',
      'feat(client): add a thing\n\nbody\n\nBREAKING CHANGE: the return type changed\n\nRefs #32',
      ['breaking']],
    ['prose absorbed as a footer after a paragraph rewrap',
      'fix: s\n\nhypothetical: some prose here\nspring-test: more prose\n',
      ['absorbed@3:1', 'absorbed@4:1']],
    ['prose absorbed even when a real footer follows it',
      'fix: s\n\nhypothetical: some prose here\n\nRefs #32', ['absorbed']],
    ['a `Word: #n` line that looks like a reference but resolves to none',
      'fix: s\n\nbody\n\nsee: #32 is fixed', ['absorbed']],
    ['the hyphenated spelling of the breaking token, which the parser accepts too',
      'fix: s\n\nprose here\n\nBREAKING-CHANGE: not really meant as one', ['breaking']],
    // Pins the marker to its position rather than to the character. Reading the subject as a
    // string cannot tell the two apart, and would wave this one through as marked.
    ['a bang in the description, which marks nothing, under a footer-only breaking note',
      'fix: do not panic!\n\nprose here\n\nBREAKING CHANGE: absolutely not intended', ['breaking']],
    // Pins the slice handed to the reference test to the footer's own span. Reading from the
    // start of the message instead would find the `Refs #32` above this line and wave it through.
    ['prose absorbed on the line after a real reference',
      'fix: s\n\nbody\n\nRefs #32\nhypothetical: some prose here', ['absorbed']],
    ...closingWords.map(([word, message]) =>
      [`\`${word}\`, one of the nine words that closes an issue`, message, ['closing']]),
    // The commit already on main, verbatim. It is the reason this rule exists, and it is the one
    // fixture whose verdict this rule changed: it sat in the accepted list until now.
    ['the closing footer real history already carries (83c51c3)',
      'docs: pin the docs page image examples to a tag that exists\n\nbody\n\nCloses #29',
      ['closing@5:1']],
    ['a closing keyword opened with a colon, which GitHub honours the same way',
      'fix: s\n\nbody\n\nresolves: #12', ['closing']],
    // No space at all between the colon and the number. GitHub documents `Closes: #10` and not
    // this, and it is not a spelling that can be tested from here without opening an issue to
    // close, so the rule takes the stricter reading: the punctuation between the word and the
    // number is not plausibly what decides whether GitHub acts, and being wrong in this direction
    // costs one contributor one word.
    ['a closing keyword jammed against the number, an untestable spelling taken strictly',
      'fix: s\n\nbody\n\nfixes:#12', ['closing']],
    ['a closing keyword naming the issue across repositories',
      'fix: s\n\nbody\n\nCloses: bilal-fazlani/mock-server#29', ['closing']],
    // Closing and absorbed at once: GitHub closes 29 on it, and the parser resolves no reference
    // from it either. One failure, both remedies - see the rendered-output fixtures below.
    ['a closing keyword naming two issues, which is also absorbed prose',
      'fix: s\n\nbody\n\nCloses #29, #30', ['closing']],
    // Pins this rule to what GitHub closes rather than to what the parser records. The full stop
    // stops the library resolving a reference at all, so the absorbed rule would fire on this
    // line - a true failure with the wrong diagnosis and a remedy (`give it a line of its own`)
    // that only leads the author to the real one on the second attempt.
    ['a closing keyword the parser resolves to no reference, which GitHub closes regardless',
      'fix: s\n\nbody\n\nFixes #12.', ['closing']],
    // The other side of that coin, and what keeps this rule off ordinary prose: one of the nine
    // words at the margin with no issue directly after it closes nothing, so it stays the
    // absorbed rule's business and gets the remedy that actually applies to it.
    ['prose opening with a closing word but naming no issue, which is absorbed and not closing',
      'fix: s\n\nbody\n\nfixed: see also #12', ['absorbed']],
    ['prose opening with a closing word and a bare `#`, which numbers no issue either',
      'fix: s\n\nbody\n\nfixed: #see the tracker for the rest', ['absorbed']],
    // Two footers, in both orders, because a rule that examined only the first or only the last
    // would still pass every single-footer fixture above it.
    ['a closing footer ahead of the house one', 'fix: s\n\nbody\n\nCloses #12\nRefs #33',
      ['closing@5:1']],
    ['a closing footer behind the house one', 'fix: s\n\nbody\n\nRefs #33\nCloses #12',
      ['closing@6:1']],
  ];
  const accepted = [
    ['a breaking change marked in the subject, with the note spelled out',
      'feat!: raise the sdk baseline to java 21\n\nbody\n\n' +
        'BREAKING CHANGE: java 21 is the floor\n\nRefs #12'],
    ['a breaking change marked in the subject alone',
      'feat!: raise the sdk baseline to java 21\n\nbody\n\nRefs #12'],
    // A scoped subject puts the `!` third, after `type` and `scope`, where an unscoped one puts
    // it second. This is the shape BREAKING_REMEDY tells authors to write, so it is the shape
    // most likely to arrive next; nothing else here would notice if only it stopped being seen.
    ['a breaking change marked in a scoped subject, with the note spelled out',
      'feat(client)!: seal the matcher hierarchy\n\nbody\n\n' +
        'BREAKING CHANGE: RequestMatcher no longer permits outside subtypes\n\nRefs #32'],
    ['the house footer', 'fix: s\n\nbody\n\nRefs #32'],
    // The remedy the closing rule prints, applied to the commit that provoked it. The rule would
    // be worthless if the message it tells authors to write failed too.
    ['the remedy for a closing footer: the same reference under the house token',
      'docs: pin the docs page image examples to a tag that exists\n\nbody\n\nRefs #29'],
    // Pins the keyword test to the whole token. Matching a substring would read `fix` out of this
    // one and reject a footer that closes nothing.
    ['a token that merely contains a closing word', 'fix: s\n\nbody\n\nPrefixes #12'],
    // Pins the rule to footers, which is where a formal link has to live to be one. Subjects and
    // prose use these words as ordinary verbs - this is 20's subject, near enough.
    ['a subject using one of the nine words as an ordinary verb',
      'fix(spring-boot): close the one-shot catalog client\n\nbody\n\nRefs #20'],
    ['a mechanical git trailer, which no remedy here would improve',
      'fix: s\n\nbody\n\nCo-authored-by: A Person <person@example.com>'],
    ['the remedy: the same breaking line indented one space',
      'fix: s\n\nprose here\n\n BREAKING CHANGE: not really meant as one'],
    ['the remedy: the same absorbed line indented one space',
      'fix: s\n\n hypothetical: some prose here\n'],
  ];
  // An expectation is the rule that must fire, optionally qualified with the position the caret
  // has to land on - `closing@5:1`. The position is spelled out wherever a fixture has more than
  // one candidate line, since a rule that reports the right verdict against the wrong line sends
  // the author to a line they did not write.
  for (const [what, message, expected] of flagged) {
    const rules = auditMessage(message).map(problem =>
      `${problem.rule}@${problem.line}:${problem.column}`);
    const seen = rules.map((rule, i) => expected[i]?.includes('@') ? rule : rule.split('@')[0]);
    if (seen.join(',') === expected.join(',')) {
      console.log(`self-test: still flagged as ${expected.join('+')} - ${what}.`);
    } else {
      console.log(`self-test FAILED: flagged as [${seen}], expected [${expected}] - ${what}.`);
      ok = false;
    }
  }

  // The verdict is only half of what this check produces; the other half is the paragraph the
  // author actually acts on, and until now nothing here read it. That is not a cosmetic gap. Swap
  // this rule's remedy for the absorbed one and every assertion above still passes, while the
  // check starts telling authors to indent `Closes #29` - which hides the line from the parser,
  // turns the run green, and leaves GitHub closing the issue exactly as before. So the rendered
  // output goes through `reportFooters` itself and is read back.
  const rendered = [
    ['a closing footer prints the house token and never the indent remedy',
      'docs: pin the docs page image examples to a tag that exists\n\nbody\n\nCloses #29',
      ['line 5: Closes #29', `\n${' '.repeat(15)}^`, 'GitHub closes the issue', 'Refs #<number>'],
      ['indent the line by one space', 'reflow the paragraph',
        'a line of its own carrying nothing but']],
    ['a closing footer carrying more than one reference asks for both edits at once',
      'fix: s\n\nbody\n\nCloses #29, #30',
      ['Refs #<number>', 'a line of its own carrying nothing but'],
      ['indent the line by one space']],
    ['an absorbed footer still prints the indent remedy, which is right for it',
      'fix: s\n\nhypothetical: some prose here\n',
      ['line 3: hypothetical: some prose here', 'indent the line by one space'],
      ['Refs #<number>']],
    ['a breaking note still prints the subject-marker remedy',
      'fix: s\n\nprose here\n\nBREAKING CHANGE: not really meant as one',
      ['MAJOR version', 'feat(scope)!'],
      ['indent the line by one space']],
    // Two rules at once, which is when the output matters most and is the last part of it that
    // nothing read. Printing only the first remedy would send an author away having fixed half
    // the commit - and every fixture above this one has exactly one problem, so none of them
    // would notice.
    ['two rules firing on one commit print both remedies',
      'fix: s\n\nbody\n\nBREAKING CHANGE: not meant\nCloses #29',
      ['feat(scope)!', 'Refs #<number>'], []],
    // The other half of that loop: several problems sharing one remedy print it once, which is
    // what the `Set` above is for. Asserted by count, since presence alone cannot see a
    // duplicate.
    ['one remedy covering two problems of the same rule is printed once, not twice',
      'fix: s\n\nhypothetical: some prose here\nspring-test: more prose\n',
      ['line 3: hypothetical', 'line 4: spring-test'], [],
      ['indent the line by one space']],
  ];
  for (const [what, message, must, mustNot, once = []] of rendered) {
    const lines = [];
    const real = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      reportFooters('0'.repeat(40), 'subject', message, auditMessage(message));
    } finally {
      console.log = real;
    }
    const output = lines.join('\n');
    const missing = must.filter(text => !output.includes(text));
    const present = mustNot.filter(text => output.includes(text));
    const repeated = once.filter(text => output.split(text).length - 1 !== 1);
    if (missing.length === 0 && present.length === 0 && repeated.length === 0) {
      console.log(`self-test: output still says what it should - ${what}.`);
    } else {
      console.log(`self-test FAILED: output missing ${JSON.stringify(missing)}, ` +
        `wrongly carrying ${JSON.stringify(present)}, not printed exactly once ` +
        `${JSON.stringify(repeated)} - ${what}.`);
      ok = false;
    }
  }

  // The one thing that would make the closing rule's position relative to ALLOWED_FOOTER_TOKENS
  // start mattering. While the two sets are disjoint the order is arbitrary; the moment a closing
  // keyword is added to the allowlist it is not, and whichever way round they then sit, one of
  // them is silently disabled. Cheaper to make that unreachable than to pin an ordering.
  const overlap = [...CLOSING_KEYWORDS].filter(word => ALLOWED_FOOTER_TOKENS.has(word));
  if (overlap.length === 0) {
    console.log('self-test: no closing keyword sits on the unconditional trailer allowlist.');
  } else {
    console.log(`self-test FAILED: ${overlap.join(', ')} is both a closing keyword and an`);
    console.log('unconditionally allowed trailer, so one of the two rules is now dead code.');
    ok = false;
  }
  for (const [what, message] of accepted) {
    const problems = auditMessage(message);
    if (problems.length === 0) {
      console.log(`self-test: still accepted - ${what}.`);
    } else {
      console.log(`self-test FAILED: now rejected - ${what}.`);
      ok = false;
    }
  }
  return ok;
}

function isMergeCommit(rev) {
  return git('log', '-1', '--format=%P', rev).trim().split(/\s+/).filter(Boolean).length > 1;
}

function resolveRange(argv) {
  if (argv.length === 1 && argv[0].includes('..')) return argv[0];
  if (argv.length === 2) {
    const [base, head] = argv;
    // `github.event.before` is all zeroes the first time a branch is pushed, and points at an
    // orphaned commit after a force-push. On the push leg that is a real situation with no usable
    // range, so the caller falls back to the head commit and says so. On a pull request it never
    // happens - `fetch-depth: 0` guarantees the base is present - so returning null there is a
    // bug being reported, not a technicality being waved through.
    if (!base || base === ZERO_SHA) return null;
    try {
      git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
    } catch {
      return null;
    }
    return `${base}..${head}`;
  }
  if (argv.length === 0) return 'HEAD~1..HEAD';
  console.error('usage: node check.mjs [--strict] [<base-sha> <head-sha> | <range> | --self-test]');
  process.exit(2);
}

const rawArgv = process.argv.slice(2);
if (rawArgv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

// Actions sets GITHUB_EVENT_NAME on every run, so the pull-request leg is strict without the
// workflow having to thread a flag through a shell expansion. --strict makes it reproducible
// locally.
const strict = rawArgv.includes('--strict') || process.env.GITHUB_EVENT_NAME === 'pull_request';
const argv = rawArgv.filter(arg => arg !== '--strict');

const head = argv.length === 2 ? argv[1] : 'HEAD';
const range = resolveRange(argv);

if (!range && strict) {
  console.error('No range to check: this base revision does not resolve to a commit.');
  console.error(`  base: "${argv[0] ?? ''}"`);
  console.error(`  head: "${head}"`);
  console.error('On a pull request the base commit is always fetched, so this is a bug in the');
  console.error('workflow or the checkout rather than a range that legitimately does not exist.');
  console.error('Failing, instead of checking the head commit alone and reporting that as a pass.');
  process.exit(1);
}

// Merge commits are excluded on purpose. A merge subject ("Merge pull request #24 from ...") has
// no Conventional-Commits separator and has never parsed, in this repo or any other; it also
// never carries a changelog entry of its own, so failing on it would be pure noise.
//
// The degraded path examines the head commit itself and nothing else. It deliberately does not
// use `rev-list --no-merges -1 head`, which walks *past* a merge head to the nearest non-merge
// ancestor and would silently report on some commit that is already on main.
const shas = range
  ? git('rev-list', '--reverse', '--no-merges', range).split('\n').filter(Boolean)
  : isMergeCommit(head) ? [] : [git('rev-parse', head).trim()];

if (range) {
  console.log(`Checking ${shas.length} non-merge commit(s) in ${range}:`);
} else {
  console.log('WARNING: no usable base revision, so this run is degraded - it checks the head');
  console.log(`commit ${head} alone rather than everything the push added.`);
  console.log('');
  console.log(shas.length
    ? `Checking the head commit ${head}:`
    : `Nothing to check: the head commit ${head} is a merge commit.`);
}
console.log('');

if (range && shas.length === 0 && strict) {
  console.error(`No non-merge commits in ${range}. A pull request always adds at least one, so`);
  console.error('an empty range means this check is looking at something other than the commits');
  console.error('it is meant to be gating - failing rather than reporting a pass over nothing.');
  process.exit(1);
}

let failures = 0;
for (const sha of shas) {
  const subject = git('log', '-1', '--format=%s', sha).trim();
  const message = git('log', '-1', '--format=%B', sha).replace(/\n+$/, '');
  let ast;
  try {
    ast = parseLikeReleasePlease(message);
  } catch (error) {
    failures++;
    report(sha, subject, error);
    continue;
  }
  const problems = auditFooters(ast, message);
  if (problems.length > 0) {
    failures++;
    reportFooters(sha, subject, message, problems);
  } else {
    console.log(`  ok   ${sha.slice(0, 8)} ${subject}`);
  }
}

console.log('');
if (failures > 0) {
  console.log(`${failures} of ${shas.length} commit message(s) do not mean what they say:`);
  console.log('dropped from the changelog outright, truncated at a line the parser read as a');
  console.log('footer, bumping a major nobody asked for, or closing an issue on landing.');
  console.log('Amend or reword them (git rebase -i) and force-push the branch.');
  process.exit(1);
}
if (shas.length === 0) {
  // Only reachable on the degraded push leg; strict runs have already exited above. Say "nothing
  // was examined" rather than "everything passed".
  console.log('No commit messages were examined.');
  process.exit(0);
}
console.log(`All ${shas.length} commit message(s) parse, and reach release-please saying what`);
console.log('they say: nothing dropped, nothing absorbed into a footer, no unmarked major bump,');
console.log('and no footer that closes its issue the moment it lands.');
