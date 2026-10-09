/*
 * Download data: one control per page, every way the page can leave.
 *
 *   Excel workbook     the summary sheet, then every table in full
 *   CSV                any one table, same columns and rows as its sheet
 *   PDF / PNG          a laid-out report: Report layout, or Glance layout
 *                      (one tile per view - where Glance View now lives)
 *
 * The workbook, CSV and report code is loaded only when this menu is used.
 */
import { useEffect, useRef, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, Loader2 } from 'lucide-react'

import type { PageDownload } from '../lib/workbook'
import type { ReportDocument, ReportLayout } from '../lib/report'

export function DownloadMenu({
  filename,
  makeTables,
  makeReport,
  label = 'Download data',
}: {
  filename: string
  makeTables: () => Promise<PageDownload>
  makeReport?: () => Promise<ReportDocument>
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [tables, setTables] = useState<PageDownload | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const shell = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    let live = true

    setTables(null)
    makeTables()
      .then(result => {
        if (live) setTables(result)
      })
      .catch(() => {
        if (live) setFailed('The tables could not be prepared.')
      })

    function onPointer(event: MouseEvent) {
      if (!shell.current?.contains(event.target as Node)) setOpen(false)
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      live = false
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const run = async (id: string, job: () => Promise<void>) => {
    setBusy(id)
    setFailed(null)

    try {
      await job()
    } catch (reason) {
      console.error(reason)
      setFailed('That download could not be produced.')
    } finally {
      setBusy(null)
    }
  }

  const report = (format: 'pdf' | 'png', layout: ReportLayout) =>
    run(`${format}-${layout}`, async () => {
      if (!makeReport) return

      const [{ saveReport }, doc] = await Promise.all([import('../lib/report'), makeReport()])

      await saveReport(doc, layout, format, filename)
    })

  return (
    <div className="rf-download" ref={shell}>
      <button
        type="button"
        className="rf-button download-master"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <Download size={16} aria-hidden />
        {/* The last word can drop on a narrow phone row ("Download"),
         * where the menu it opens says what is downloaded. */}
        {label.includes(' ') ? (
          <span>
            {label.slice(0, label.lastIndexOf(' '))}
            <span className="rf-download-rest">{label.slice(label.lastIndexOf(' '))}</span>
          </span>
        ) : (
          label
        )}
      </button>

      {open && (
        <div className="rf-download-menu" role="menu">
          <div className="rf-download-group">
            <span className="rf-download-head">Data</span>
            <button
              type="button"
              role="menuitem"
              disabled={!tables || busy !== null}
              onClick={() =>
                tables &&
                run('xlsx', async () => {
                  const { saveWorkbook } = await import('../lib/workbook')

                  await saveWorkbook(tables)
                })
              }
            >
              {busy === 'xlsx' ? <Loader2 size={16} className="spin" aria-hidden /> : <FileSpreadsheet size={16} aria-hidden />}
              Excel workbook, every table
            </button>

            {tables?.tables.map(table => (
              <button
                key={table.key}
                type="button"
                role="menuitem"
                className="rf-download-csv"
                disabled={busy !== null}
                onClick={() =>
                  run(`csv-${table.key}`, async () => {
                    const { saveTableCsv } = await import('../lib/workbook')

                    saveTableCsv(tables, table)
                  })
                }
              >
                CSV · {table.sheet}
              </button>
            ))}

            {!tables && !failed && <span className="rf-download-wait">Preparing tables…</span>}
          </div>

          {makeReport && (
            <div className="rf-download-group">
              <span className="rf-download-head">Report</span>
              {(['report', 'glance'] as const).map(layout => (
                <div key={layout} className="rf-download-pair">
                  <span>{layout === 'report' ? 'Report layout' : 'Glance layout'}</span>
                  <button type="button" role="menuitem" disabled={busy !== null} onClick={() => report('pdf', layout)}>
                    {busy === `pdf-${layout}` ? <Loader2 size={15} className="spin" aria-hidden /> : <FileText size={15} aria-hidden />} PDF
                  </button>
                  <button type="button" role="menuitem" disabled={busy !== null} onClick={() => report('png', layout)}>
                    {busy === `png-${layout}` ? <Loader2 size={15} className="spin" aria-hidden /> : <ImageIcon size={15} aria-hidden />} PNG
                  </button>
                </div>
              ))}
            </div>
          )}

          {failed && <p className="rf-download-error">{failed}</p>}
        </div>
      )}
    </div>
  )
}
