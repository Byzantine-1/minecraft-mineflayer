const TASK_IDS = [
  'gatherFood',
  'healRest',
  'fleeShelter',
  'attendService',
  'patrol',
  'guardChurch',
  'workTrade',
  'chopWood',
  'mineOre',
  'escortCaravan',
  'raidDefense',
  'diplomacy'
]

const BASE_RISK = {
  gatherFood: 8,
  healRest: 2,
  fleeShelter: 3,
  attendService: 4,
  patrol: 16,
  guardChurch: 14,
  workTrade: 10,
  chopWood: 13,
  mineOre: 18,
  escortCaravan: 22,
  raidDefense: 30,
  diplomacy: 6
}

const ROLE_WEIGHTS = {
  trader: {
    workTrade: 32,
    escortCaravan: 22,
    diplomacy: 20,
    gatherFood: 8
  },
  woodcutter: {
    chopWood: 32,
    workTrade: 12,
    gatherFood: 10
  },
  miner: {
    mineOre: 32,
    workTrade: 12,
    gatherFood: 10
  },
  farmer: {
    gatherFood: 34,
    workTrade: 10,
    attendService: 8
  },
  guard: {
    patrol: 30,
    raidDefense: 28,
    guardChurch: 18,
    escortCaravan: 14
  },
  cleric: {
    attendService: 30,
    guardChurch: 14,
    diplomacy: 12,
    healRest: 12
  },
  builder: {
    workTrade: 20,
    chopWood: 14,
    mineOre: 14
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function needUrgency(needValue, threshold) {
  if (needValue >= threshold) {
    return 0
  }
  return clamp((threshold - needValue) / threshold, 0, 1)
}

function calculateNeedWeight(taskId, needs, authoritySnapshot) {
  const hungerUrgency = needUrgency(needs.hunger, 35)
  const fatigueUrgency = needUrgency(needs.fatigue, 25)
  const safetyUrgency = needUrgency(needs.safety, 40)
  const socialUrgency = needUrgency(needs.social, 30)
  const purposeUrgency = needUrgency(needs.purpose, 30)
  const faithUrgency = needUrgency(needs.faith, 30)
  const famine = Number(authoritySnapshot?.events?.famineSeverity) || 0

  switch (taskId) {
    case 'gatherFood':
      return hungerUrgency * 52 + famine * 0.2
    case 'healRest':
      return fatigueUrgency * 56 + safetyUrgency * 8
    case 'fleeShelter':
      return safetyUrgency * 60 + fatigueUrgency * 6
    case 'attendService':
      return faithUrgency * 32 + socialUrgency * 16
    case 'patrol':
      return safetyUrgency * 24 + purposeUrgency * 14
    case 'guardChurch':
      return safetyUrgency * 18 + faithUrgency * 15
    case 'workTrade':
      return purposeUrgency * 28 + socialUrgency * 8
    case 'chopWood':
      return purposeUrgency * 24
    case 'mineOre':
      return purposeUrgency * 24
    case 'escortCaravan':
      return purposeUrgency * 22 + socialUrgency * 6
    case 'raidDefense':
      return safetyUrgency * 46 + purposeUrgency * 10
    case 'diplomacy':
      return socialUrgency * 20 + purposeUrgency * 10 + faithUrgency * 8
    default:
      return 0
  }
}

function calculateEventWeight(taskId, authoritySnapshot) {
  const famine = Number(authoritySnapshot?.events?.famineSeverity) || 0
  const warIntensity = Number(authoritySnapshot?.events?.war?.intensity) || 0
  const raidSeverity = Number(authoritySnapshot?.events?.raidSeverity) || 0
  const nightDanger = Number(authoritySnapshot?.nightDangerIndex) || 0
  const longNight = !!authoritySnapshot?.events?.longNight
  const serviceActive = !!authoritySnapshot?.serviceActive

  switch (taskId) {
    case 'gatherFood':
      return famine * 0.55
    case 'healRest':
      return nightDanger * 0.2
    case 'fleeShelter':
      return nightDanger * 0.7 + raidSeverity * 0.3
    case 'patrol':
      return nightDanger * 0.4 + warIntensity * 0.3 + raidSeverity * 0.4
    case 'guardChurch':
      return longNight ? 8 : 0
    case 'attendService':
      return serviceActive ? 24 : -10
    case 'workTrade':
      return famine > 60 ? -12 : 10
    case 'escortCaravan':
      return warIntensity > 40 ? 20 : 6
    case 'raidDefense':
      return raidSeverity * 0.8 + warIntensity * 0.45
    case 'diplomacy':
      return warIntensity > 30 ? 26 : 8
    default:
      return 0
  }
}

function calculatePolicyWeight(taskId, authoritySnapshot, economyStatus) {
  const priorities = authoritySnapshot?.institutions?.council?.priorities || {}
  const foodPriority = Number(priorities.food) || 1
  const defensePriority = Number(priorities.defense) || 0.5
  const expansionPriority = Number(priorities.expansion) || 0.4
  const storage = economyStatus?.storage || ''

  if (taskId === 'gatherFood') {
    return foodPriority * 10
  }
  if (taskId === 'patrol' || taskId === 'raidDefense' || taskId === 'guardChurch') {
    return defensePriority * 10
  }
  if (taskId === 'workTrade' || taskId === 'chopWood' || taskId === 'mineOre') {
    return expansionPriority * 8
  }
  if (taskId === 'attendService' && storage.includes('food_stock')) {
    return 4
  }
  return 0
}

function calculateDistancePenalty(taskId, perception) {
  const distance = Number(perception?.taskDistances?.[taskId]) || 0
  const cap = 48
  return clamp((distance / cap) * 12, 0, 12)
}

function roleWeightForTask(taskId, roles) {
  const primary = roles?.primary
  const secondary = roles?.secondary
  const primaryWeight = ROLE_WEIGHTS?.[primary]?.[taskId] || 0
  const secondaryWeight = ROLE_WEIGHTS?.[secondary]?.[taskId] || 0
  return primaryWeight + secondaryWeight * 0.4
}

function chooseTask({
  needs,
  roles,
  authoritySnapshot,
  economyStatus,
  perception,
  availableTasks
}) {
  const tasks = Array.isArray(availableTasks) && availableTasks.length > 0
    ? availableTasks
    : TASK_IDS

  let best = null
  const scoreTable = {}

  for (const taskId of tasks) {
    const roleWeight = roleWeightForTask(taskId, roles)
    const needWeight = calculateNeedWeight(taskId, needs, authoritySnapshot)
    const eventWeight = calculateEventWeight(taskId, authoritySnapshot)
    const policyWeight = calculatePolicyWeight(taskId, authoritySnapshot, economyStatus)
    const riskPenalty = (BASE_RISK[taskId] || 0) * ((authoritySnapshot?.nightDangerIndex || 0) / 100)
    const distancePenalty = calculateDistancePenalty(taskId, perception)
    const score = roleWeight + needWeight + eventWeight + policyWeight - riskPenalty - distancePenalty

    scoreTable[taskId] = Number(score.toFixed(2))

    if (!best || score > best.score) {
      best = {
        taskId,
        score
      }
    }
  }

  if (!best) {
    return {
      taskId: 'idle',
      score: 0,
      scoreTable
    }
  }

  const minimumScore = 18
  if (best.score < minimumScore) {
    return {
      taskId: 'idle',
      score: Number(best.score.toFixed(2)),
      scoreTable
    }
  }

  return {
    taskId: best.taskId,
    score: Number(best.score.toFixed(2)),
    scoreTable
  }
}

module.exports = {
  TASK_IDS,
  chooseTask
}
