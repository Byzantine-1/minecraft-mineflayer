function normalizeAdminUsers(adminUsersInput) {
  if (Array.isArray(adminUsersInput)) {
    return adminUsersInput
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  }

  return String(adminUsersInput || process.env.ADMIN_USERS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function isAdmin(username, adminUsersInput) {
  const user = String(username || '').trim().toLowerCase()
  if (!user) {
    return false
  }
  const adminUsers = normalizeAdminUsers(adminUsersInput)
  return adminUsers.includes(user)
}

module.exports = {
  normalizeAdminUsers,
  isAdmin
}
