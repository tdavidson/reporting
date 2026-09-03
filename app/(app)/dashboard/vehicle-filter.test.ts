import { describe, it, expect } from 'vitest'
import { UNASSIGNED_VEHICLE, matchesVehicle, vehicleFilterOptions } from './vehicle-filter'

const co = (portfolioGroup: string[] | null) => ({ portfolioGroup })

describe('matchesVehicle', () => {
  it('matches everything when no vehicle is selected', () => {
    expect(matchesVehicle(co(['Fund I']), '')).toBe(true)
    expect(matchesVehicle(co(null), '')).toBe(true)
  })

  it('matches a company that belongs to the selected vehicle', () => {
    expect(matchesVehicle(co(['Fund I', 'SPV A']), 'SPV A')).toBe(true)
    expect(matchesVehicle(co(['Fund I']), 'SPV A')).toBe(false)
    expect(matchesVehicle(co(null), 'SPV A')).toBe(false)
  })

  it('"unassigned" matches only companies with no vehicle', () => {
    expect(matchesVehicle(co(null), UNASSIGNED_VEHICLE)).toBe(true)
    expect(matchesVehicle(co([]), UNASSIGNED_VEHICLE)).toBe(true)
    expect(matchesVehicle(co(['Fund I']), UNASSIGNED_VEHICLE)).toBe(false)
  })
})

describe('vehicleFilterOptions', () => {
  it('lists the vehicles and adds Unassigned only when some company has none', () => {
    expect(vehicleFilterOptions(['Fund I', 'SPV A'], [co(['Fund I']), co(['SPV A'])]))
      .toEqual([{ value: 'Fund I', label: 'Fund I' }, { value: 'SPV A', label: 'SPV A' }])
    expect(vehicleFilterOptions(['Fund I'], [co(['Fund I']), co(null)]))
      .toEqual([{ value: 'Fund I', label: 'Fund I' }, { value: UNASSIGNED_VEHICLE, label: 'Unassigned' }])
  })
})
