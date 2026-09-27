import { describe, expect, it } from 'vitest'
import { orderTables, orderViews, tableKey } from './dump-order'

const table = (name: string, ...references: string[]) => ({
  schema: 's',
  name,
  references: references.map((reference) => ({ schema: 's', name: reference }))
})

describe('orderTables', () => {
  it('creates referenced tables first, keeping the given order otherwise', () => {
    const { order, cyclic } = orderTables([
      table('orders', 'people', 'products'),
      table('people'),
      table('products'),
      table('lines', 'orders', 'products')
    ])
    expect(order.map((entry) => entry.name)).toEqual(['people', 'products', 'orders', 'lines'])
    expect(cyclic.size).toBe(0)
  })

  it('ignores self references and tables outside the dump', () => {
    const { order, cyclic } = orderTables([table('staff', 'staff', 'departments')])
    expect(order.map((entry) => entry.name)).toEqual(['staff'])
    expect(cyclic.size).toBe(0)
  })

  it('breaks a cycle at its first table and names it', () => {
    const { order, cyclic } = orderTables([
      table('a', 'b'),
      table('b', 'c'),
      table('c', 'a'),
      table('d', 'c')
    ])
    expect(order.map((entry) => entry.name)).toEqual(['a', 'c', 'b', 'd'])
    expect([...cyclic]).toEqual([tableKey({ schema: 's', name: 'a' })])
  })
})

describe('orderViews', () => {
  it('creates a view after the views its definition names', () => {
    const views = [
      { name: 'top_customers', definition: 'select * from customer_totals where total > 100' },
      { name: 'customer_totals', definition: 'select id, sum(x) as total from orders group by id' },
      { name: 'plain', definition: 'select 1' }
    ]
    expect(orderViews(views).map((view) => view.name)).toEqual([
      'customer_totals',
      'top_customers',
      'plain'
    ])
  })

  it('does not take a longer name for a shorter one', () => {
    const views = [
      { name: 'x', definition: 'select * from ab' },
      { name: 'b', definition: 'select 1' }
    ]
    expect(orderViews(views).map((view) => view.name)).toEqual(['x', 'b'])
  })
})
