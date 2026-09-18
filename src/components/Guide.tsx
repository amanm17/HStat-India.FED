import { ArrowUpRight } from 'lucide-react'

/*
 * How to read this dashboard.
 *
 * Written because the single most expensive mistake this project has made was
 * a reader - us - taking a number to mean something it did not. Every section
 * here exists to stop a specific misreading that has actually happened or was
 * one step away.
 */
export function Guide({
  onHome,
  onOpen,
  onLines,
}: {
  onHome: () => void
  onOpen?: (code: string, level: 2 | 4 | 6) => void
  onLines: () => void
}) {
  return (
    <div className="guide-page">
      <div className="eyebrow">HOW TO READ THIS DASHBOARD</div>

      <h1>A short guide</h1>

      <p className="guide-lede">
        HStat.India puts two different measurements side by side and works hard
        to keep them apart. Most of what is worth knowing is which one you are
        looking at.
      </p>

      <section>
        <h2>The two sources, and why they are never added together</h2>

        <div className="guide-two">
          <div>
            <h3>UN Comtrade</h3>
            <p>
              The world's trade in a six-digit product line, added up across
              every economy that files. This is where the big headline figures
              come from — world trade, India's share, who buys and who sells.
            </p>
            <ul>
              <li>Six digits. Every country uses the same code.</li>
              <li>Calendar years.</li>
              <li>Currently complete to 2024; 2025 is patchy, 2026 is empty.</li>
            </ul>
          </div>

          <div>
            <h3>DGCIS / TIA</h3>
            <p>
              India's own customs authority reporting India's own trade, at
              India's eight-digit tariff line, monthly. Fresher than Comtrade,
              and only about India.
            </p>
            <ul>
              <li>Eight digits. India's own schedule; no other country uses it.</li>
              <li>Calendar months, currently to June 2026.</li>
              <li>Both directions: what India ships, and what it brings in.</li>
            </ul>
          </div>
        </div>

        <p className="guide-warn">
          <strong>The word that catches people out is “World”.</strong> On a
          DGCIS panel, partner “World” means <em>India trading with everywhere</em>.
          It does not mean world trade. A DGCIS figure and a Comtrade figure
          must never be added together, and neither is a version of the other.
        </p>
      </section>

      <section>
        <h2>Why some years are blank</h2>
        <p>
          A world figure is only published when enough countries have filed to
          defend it. When they have not, the year is left blank rather than
          estimated — a blank means “we do not know”, never “zero”. Pages show
          <strong> VALID</strong>, <strong>CAUTION</strong> or nothing at all,
          and the reason is always on the page.
        </p>
        <p>
          2025 is thin mostly because of one absentee: China has not filed it
          yet, and China is in 240 of our 418 products. 2026 has nothing from
          anyone. India is the exception — its own data runs to June 2026,
          which is why the tariff-line panels are fresher than the world ones
          above them.
        </p>
      </section>

      <section>
        <h2>Four levels, and what each is for</h2>
        <dl className="guide-levels">
          <dt>HS-2 · chapter</dt>
          <dd>The broadest grouping. Useful for orientation, rarely for analysis.</dd>

          <dt>HS-4 · heading</dt>
          <dd>A family of related products.</dd>

          <dt>HS-6 · product</dt>
          <dd>
            The workhorse. The finest level that is comparable between
            countries, so all world figures live here. Each of the 418 products
            has its own page.
          </dd>

          <dt>HS-8 · tariff line</dt>
          <dd>
            India's own subdivision. There is <em>no</em> world figure at eight
            digits, because beyond six every country writes its own schedule.
            A line is identified by its code — <code>85176290</code> — because
            until India's published schedule is loaded, the only name available
            is the heading's, which its siblings share.{' '}
            <button className="linkish" onClick={onLines}>
              Browse all 543 lines <ArrowUpRight size={12} />
            </button>
          </dd>
        </dl>
      </section>

      <section>
        <h2>Getting around</h2>
        <ul className="guide-list">
          <li>
            <strong>The left rail</strong> is places: home, search, all tariff
            lines, this guide, plus anything you have pinned or visited.
          </li>
          <li>
            <strong>The right rail</strong> is tools for the page in front of
            you: which panels show, how they are arranged, and building a report.
          </li>
          <li>
            <strong>Search</strong> takes a product word (“smartphone”), a code
            at any level (“8517”, “85176290”), or a plain question. Tariff-line
            results appear in their own group, never mixed into the world
            product results.
          </li>
          <li>
            <strong>Type <kbd>/</kbd> in the search box</strong> for commands —
            jump somewhere, switch flow or currency, build a report, open this
            guide.
          </li>
          <li>
            <strong>Every page has a URL.</strong> <code>/hs/851762</code> is a
            product, <code>/hs/85176290</code> a tariff line. Both can be sent
            to someone.
          </li>
        </ul>
      </section>

      <section>
        <h2>Taking figures out</h2>
        <p>
          The workbook button on a product page gives you everything on it:
          annual and monthly world figures, largest importers and exporters,
          India's own partners, and — on a separate sheet — India's tariff lines
          for that heading, both flows. Every DGCIS row repeats its reporter,
          partner and flow, because a spreadsheet gets sorted and forwarded, and
          a row read alone still has to say what it is.
        </p>
        <p>
          <strong>INR crore and USD million are both filed by DGCIS and are
          never converted between each other.</strong> Neither can be used to
          derive an exchange rate.
        </p>
      </section>

      <section>
        <h2>If a number looks wrong</h2>
        <p>
          Check three things in this order: which source it came from, which
          flow it is, and which period basis. Almost every surprise on this
          dashboard turns out to be one of the three — and the one that caught
          us hardest was a flow label that said imports over data that was
          exports.
        </p>
      </section>

      <button className="linkish guide-home" onClick={onHome}>
        Back to the front page
      </button>
    </div>
  )
}
