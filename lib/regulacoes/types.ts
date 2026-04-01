export type Issuer = 'CVM' | 'BCB' | 'CMN' | 'OTHER'

export interface ImpactEntry {
  sectorOrType: string
  why: string
}

export interface RegulationImpacts {
  firstOrder: ImpactEntry[]
  secondOrder: ImpactEntry[]
  thirdOrder: ImpactEntry[]
}

export interface Regulation {
  id: string
  name: string
  shortName: string
  issuer: Issuer
  date: string // ISO: "2023-09-28"
  description: string
  fullContext: string
  whatChanged: string
  officialUrl: string
  impacts: RegulationImpacts
  tags?: string[]
}
