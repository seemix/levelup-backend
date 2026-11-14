/**
 * CSV of the finance and salary reports (spec §8 «Експорт у CSV», A37 format): UTF-8 with BOM, `;`,
 * CRLF, headers in the requested language, money as decimal lei, formulas neutralized in free text.
 * Pure functions: the labels and the names come from the caller.
 */
import type { CrmKey } from '@/i18n'

import { csvCell, CSV_SEPARATOR } from './client-report'
import type { FinanceReport } from './finance-report'
import { baniToLeiText } from './money'
import type { SalaryReport } from './salary'
import { toLocalDate } from './time'

export type Translate = (key: CrmKey) => string

export type ReportNames = Partial<
  Record<
    'locations' | 'registers' | 'barbers' | 'categories' | 'services' | 'extras' | 'promoCodes',
    Record<string, string>
  >
>

type Cell = { value: string | number | null; text?: boolean }
type Section = { title: string; header: string[]; rows: Cell[][] }

const money = (bani: number): Cell => ({ value: baniToLeiText(bani) })
const count = (value: number): Cell => ({ value })
const text = (value: string): Cell => ({ value, text: true })

const write = (sections: Section[]): string => {
  const line = (cells: string[]) => cells.join(CSV_SEPARATOR)
  const lines: string[] = []
  for (const [index, section] of sections.entries()) {
    if (index > 0) lines.push('')
    lines.push(line([csvCell(section.title, true)]))
    lines.push(line(section.header.map((label) => csvCell(label))))
    for (const row of section.rows)
      lines.push(line(row.map((cell) => csvCell(cell.value, cell.text))))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

const nameOf = (names: Record<string, string> | undefined, id: string | null, fallback: string) =>
  (id && names?.[id]) || fallback

export const financeToCsv = (
  report: FinanceReport,
  names: ReportNames,
  t: Translate,
  profit?: { income: number; expenses: number; salary: number; profit: number } | null,
): string => {
  const c = (key: string) => t(`reports.finance.columns.${key}` as CrmKey)
  const unknown = t('reports.finance.unknown')
  const total = t('reports.finance.totalRow')
  const incomeHeader = (first: string) => [
    first,
    c('payments'),
    c('refunds'),
    c('certificateSales'),
    c('net'),
  ]
  const incomeCells = (row: FinanceReport['income']['totals']): Cell[] => [
    money(row.payments),
    money(row.refunds),
    money(row.certificateSales),
    money(row.net),
  ]
  const { income, revenue, expenses, registers, promo, certificates } = report

  const sections: Section[] = [
    {
      title: t('reports.finance.sections.byLocation'),
      header: incomeHeader(c('location')),
      rows: [
        ...income.byLocation.map((row) => [
          text(nameOf(names.locations, row.id, unknown)),
          ...incomeCells(row),
        ]),
        [text(total), ...incomeCells(income.totals)],
      ],
    },
    {
      title: t('reports.finance.sections.byRegister'),
      header: incomeHeader(c('register')),
      rows: income.byRegister.map((row) => [
        text(nameOf(names.registers, row.id, unknown)),
        ...incomeCells(row),
      ]),
    },
    {
      title: t('reports.finance.sections.byBarber'),
      header: [c('barber'), c('payments'), c('refunds'), c('net'), c('certificate'), c('revenue')],
      rows: income.byBarber.map((row) => [
        text(nameOf(names.barbers, row.barber, unknown)),
        money(row.payments),
        money(row.refunds),
        money(row.net),
        money(row.certificate),
        money(row.revenue),
      ]),
    },
    {
      title: t('reports.finance.sections.revenue'),
      header: [c('item'), c('itemType'), c('appointments'), c('amount')],
      rows: [
        ...revenue.items.map((row) => [
          text(
            nameOf(
              row.itemType === 'extra' ? names.extras : names.services,
              row.item,
              t('reports.finance.deletedItem'),
            ),
          ),
          text(t(`appointments.itemTypes.${row.itemType}` as CrmKey)),
          count(row.appointments),
          money(row.amount),
        ]),
        [text(total), text(''), text(''), money(revenue.total)],
        [text(c('certificate')), text(''), text(''), money(revenue.certificate)],
      ],
    },
    {
      title: t('reports.finance.sections.expensesByCategory'),
      header: [c('category'), c('count'), c('amount')],
      rows: [
        ...expenses.byCategory.map((row) => [
          text(nameOf(names.categories, row.id, t('reports.finance.noCategory'))),
          count(row.count),
          money(row.amount),
        ]),
        [text(total), text(''), money(expenses.total)],
      ],
    },
    {
      title: t('reports.finance.sections.expensesByRegister'),
      header: [c('register'), c('count'), c('amount')],
      rows: expenses.byRegister.map((row) => [
        text(nameOf(names.registers, row.id, unknown)),
        count(row.count),
        money(row.amount),
      ]),
    },
    {
      title: t('reports.finance.sections.registers'),
      header: [
        c('register'),
        c('location'),
        c('opening'),
        c('inflow'),
        c('outflow'),
        c('closing'),
        c('balance'),
      ],
      rows: [
        ...registers.rows.map((row) => [
          text(nameOf(names.registers, row.register, unknown)),
          text(nameOf(names.locations, row.location, unknown)),
          money(row.opening),
          money(row.inflow),
          money(row.outflow),
          money(row.closing),
          money(row.balance),
        ]),
        [
          text(total),
          text(''),
          money(registers.totals.opening),
          money(registers.totals.inflow),
          money(registers.totals.outflow),
          money(registers.totals.closing),
          money(registers.totals.balance),
        ],
      ],
    },
    {
      title: t('reports.finance.sections.promo'),
      header: [c('code'), c('uses'), c('discount')],
      rows: [
        ...promo.codes.map((row) => [
          text(nameOf(names.promoCodes, row.promoCode, unknown)),
          count(row.uses),
          money(row.discount),
        ]),
        [text(total), count(promo.uses), money(promo.discount)],
      ],
    },
    {
      title: t('reports.finance.sections.certificates'),
      header: [c('name'), c('count'), c('amount')],
      rows: [
        [
          text(t('reports.finance.certificates.sold')),
          count(certificates.sold.count),
          money(certificates.sold.amount),
        ],
        [text(t('reports.finance.certificates.redeemed')), text(''), money(certificates.redeemed)],
        [
          text(t('reports.finance.certificates.outstanding')),
          count(certificates.outstanding.count),
          money(certificates.outstanding.amount),
        ],
        [
          text(t('reports.finance.certificates.expired')),
          count(certificates.expired.count),
          money(certificates.expired.amount),
        ],
      ],
    },
  ]
  if (profit)
    sections.push({
      title: t('reports.finance.sections.profit'),
      header: [c('name'), c('amount')],
      rows: (['income', 'expenses', 'salary', 'profit'] as const).map((key) => [
        text(t(`reports.finance.profit.${key}` as CrmKey)),
        money(profit[key]),
      ]),
    })
  return write(sections)
}

const percent = (value: number): Cell => ({ value: String(value) })

export const salaryToCsv = (
  salary: SalaryReport,
  names: ReportNames,
  t: Translate,
  withItems = false,
): string => {
  const c = (key: string) => t(`reports.salary.columns.${key}` as CrmKey)
  const sections: Section[] = [
    {
      title: t('reports.salary.title'),
      header: [
        c('barber'),
        c('payments'),
        c('refunds'),
        c('servicesBase'),
        c('servicesPercent'),
        c('servicesCommission'),
        c('extrasBase'),
        c('extrasPercent'),
        c('extrasCommission'),
        c('fixedSalary'),
        c('total'),
      ],
      rows: [
        ...salary.rows.map((row) => [
          text(nameOf(names.barbers, row.barber, t('reports.finance.unknown'))),
          count(row.payments),
          count(row.refunds),
          money(row.servicesBase),
          percent(row.servicesPercent),
          money(row.servicesCommission),
          money(row.extrasBase),
          percent(row.extrasPercent),
          money(row.extrasCommission),
          money(row.fixedSalary),
          money(row.total),
        ]),
        [
          text(t('reports.finance.totalRow')),
          count(salary.totals.payments),
          count(salary.totals.refunds),
          money(salary.totals.servicesBase),
          text(''),
          money(salary.totals.servicesCommission),
          money(salary.totals.extrasBase),
          text(''),
          money(salary.totals.extrasCommission),
          money(salary.totals.fixedSalary),
          money(salary.totals.total),
        ],
      ],
    },
  ]
  if (withItems)
    sections.push({
      title: t('reports.salary.details'),
      header: [c('date'), c('type'), c('servicesBase'), c('extrasBase')],
      rows: salary.items.map((item) => [
        text(toLocalDate(item.occurredAt)),
        text(t(`transactions.types.${item.type}` as CrmKey)),
        money(item.servicesBase),
        money(item.extrasBase),
      ]),
    })
  return write(sections)
}
