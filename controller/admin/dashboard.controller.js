const mongoose = require('mongoose')
const { subDays, startOfDay, format, formatDistanceToNow } = require('date-fns')
const Admin = require('../../model/Admin')
const AuditLog = require('../../model/AuditLog')
const Brand = require('../../model/Brand')
const Content = require('../../model/Content')
const ContentType = require('../../model/ContentType')
const CustomForm = require('../../model/CustomForm')
const CustomFormData = require('../../model/CustomFormData')
const Media = require('../../model/Media')
const Menu = require('../../model/Menu')
const User = require('../../model/User')
const { logError } = require('../../helper/Logger.helper')

/*
 * Role-aware dashboard.
 *
 * Each widget names the privilege it needs. Only the widgets the admin may see are
 * loaded, so data for anything else is never queried or sent to the page.
 * super_admin and admin see everything, matching checkRouteAccess.
 * Privilege ids come from config/userPrivilege.config.js and are put on
 * res.locals.userPrivileges by checkRouteAccess.
 */

const FULL_ACCESS_ROLES = ['super_admin', 'admin']

const toObjectId = (id) =>
    id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(String(id)) : id

const timeAgo = (date) =>
    date ? formatDistanceToNow(new Date(date), { addSuffix: true }) : ''

const buildContext = async (req, res) => {
    const session = req.authUser
    const role = session.admin_role
    const fullAccess = FULL_ACCESS_ROLES.includes(role)
    const privileges = new Set(res.locals.userPrivileges || [])
    const can = (id) => fullAccess || privileges.has(id)

    // Same content type list the privilege config is built from
    const contentTypes = session.brand?._id
        ? await ContentType.find({ brand: session.brand._id, active: true })
              .select('title slug single_type')
              .sort({ position: 1 })
              .lean()
        : []

    return {
        session,
        role,
        fullAccess,
        can,
        now: new Date(),
        // Session ids are strings. find() casts them, but aggregate() doesn't,
        // so cast here to make both kinds of query match.
        scope: { brand: toObjectId(session.brand?._id), country: toObjectId(session.brand?.country) },
        defaultLang: session.brand?.languages?.[0]?.prefix || 'en',
        viewableTypes: contentTypes.filter((t) => can(`${t.slug}.view`)),
        manageableTypes: contentTypes.filter((t) => can(`${t.slug}.manage`)),
    }
}

/* ---------- Widgets ---------- */

const contentWidget = {
    key: 'content',
    allowed: (ctx) => ctx.viewableTypes.length > 0 && !!ctx.scope.brand,
    load: async (ctx) => {
        const typeBySlug = Object.fromEntries(ctx.viewableTypes.map((t) => [t.slug, t]))
        const filter = {
            ...ctx.scope,
            deleted: { $ne: true },
            type_slug: { $in: Object.keys(typeBySlug) },
        }
        const listFields = 'slug type_slug status updated_at scheduled_at last_edited_user'
        const toItem = (doc) => ({
            id: doc._id,
            slug: doc.slug,
            status: doc.status,
            type: typeBySlug[doc.type_slug]?.title || doc.type_slug,
            url: `/admin/cms/${doc.type_slug}/edit/${doc._id}`,
            editor: doc.last_edited_user?.name || '',
            updatedAgo: timeAgo(doc.updated_at),
            startsOn: doc.scheduled_at?.start
                ? format(new Date(doc.scheduled_at.start), 'dd MMM yyyy, HH:mm')
                : '',
        })

        const [statusCounts, recent, scheduled, mine] = await Promise.all([
            Content.aggregate([
                { $match: filter },
                { $group: { _id: { type: '$type_slug', status: '$status' }, count: { $sum: 1 } } },
            ]),
            Content.find(filter)
                .select(listFields)
                .populate('last_edited_user', 'name')
                .sort({ updated_at: -1 })
                .limit(6)
                .lean(),
            Content.find({
                ...filter,
                status: 'scheduled',
                'scheduled_at.start': { $gte: ctx.now },
            })
                .select(listFields)
                .sort({ 'scheduled_at.start': 1 })
                .limit(5)
                .lean(),
            Content.find({ ...filter, last_edited_user: ctx.session.admin_id })
                .select(listFields)
                .sort({ updated_at: -1 })
                .limit(5)
                .lean(),
        ])

        const totals = { total: 0, published: 0, unpublished: 0, scheduled: 0 }
        const perType = {}
        statusCounts.forEach(({ _id, count }) => {
            totals.total += count
            if (totals[_id.status] !== undefined) totals[_id.status] += count
            perType[_id.type] = (perType[_id.type] || 0) + count
        })

        const byType = ctx.viewableTypes
            .map((t) => ({ title: t.title, url: `/admin/cms/${t.slug}`, count: perType[t.slug] || 0 }))
            .sort((a, b) => b.count - a.count)

        return {
            totals,
            byType,
            maxTypeCount: Math.max(1, ...byType.map((t) => t.count)),
            recent: recent.map(toItem),
            scheduled: scheduled.map(toItem),
            mine: mine.map(toItem),
        }
    },
}

const formsWidget = {
    key: 'forms',
    allowed: (ctx) =>
        !!ctx.scope.brand && (ctx.can('custom_forms.view') || ctx.can('custom_forms.data')),
    load: async (ctx) => {
        const formCount = await CustomForm.countDocuments({ ...ctx.scope, deleted: { $ne: true } })
        // Submissions hold personal data, so they need the "Data Manage" privilege
        if (!ctx.can('custom_forms.data')) {
            return { formCount, canSeeSubmissions: false }
        }

        const today = startOfDay(ctx.now)
        const trendStart = subDays(today, 13)
        const since = (date) => ({ ...ctx.scope, created_at: { $gte: date } })

        const [todayCount, weekCount, monthCount, daily, latest] = await Promise.all([
            CustomFormData.countDocuments(since(today)),
            CustomFormData.countDocuments(since(subDays(today, 6))),
            CustomFormData.countDocuments(since(subDays(today, 29))),
            CustomFormData.aggregate([
                { $match: since(trendStart) },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
                        count: { $sum: 1 },
                    },
                },
            ]),
            CustomFormData.find(ctx.scope)
                .select('form_id created_at')
                .populate('form_id', 'form_name')
                .sort({ created_at: -1 })
                .limit(5)
                .lean(),
        ])

        const dailyMap = Object.fromEntries(daily.map((d) => [d._id, d.count]))
        const trend = Array.from({ length: 14 }, (_, i) => {
            const day = subDays(today, 13 - i)
            return { label: format(day, 'dd MMM'), count: dailyMap[format(day, 'yyyy-MM-dd')] || 0 }
        })

        return {
            formCount,
            canSeeSubmissions: true,
            todayCount,
            weekCount,
            monthCount,
            trend,
            maxTrend: Math.max(1, ...trend.map((d) => d.count)),
            latest: latest.map((s) => ({
                form: s.form_id?.form_name?.[ctx.defaultLang] || 'Deleted form',
                url: s.form_id ? `/admin/custom-forms/submissions/${s.form_id._id}/${s._id}` : null,
                createdAgo: timeAgo(s.created_at),
            })),
        }
    },
}

const mediaWidget = {
    key: 'media',
    allowed: (ctx) => ctx.can('media.view'),
    // The media library is shared across brands, so this isn't brand-scoped either
    load: async () => {
        const [byType, recent] = await Promise.all([
            Media.aggregate([
                {
                    $group: {
                        _id: '$file_type',
                        count: { $sum: 1 },
                        size: { $sum: { $ifNull: ['$upload_info.size', 0] } },
                    },
                },
                { $sort: { count: -1 } },
            ]),
            Media.find({ file_type: 'image' })
                .select('url meta.title upload_info.original_name')
                .sort({ _id: -1 })
                .limit(6)
                .lean(),
        ])
        const totalSize = byType.reduce((sum, t) => sum + t.size, 0)
        return {
            total: byType.reduce((sum, t) => sum + t.count, 0),
            totalSizeMb: (totalSize / (1024 * 1024)).toFixed(1),
            byType: byType.map((t) => ({ type: t._id || 'other', count: t.count })),
            recent: recent.map((m) => ({
                url: m.url,
                title: m.meta?.title || m.upload_info?.original_name || '',
            })),
        }
    },
}

const menuWidget = {
    key: 'menus',
    allowed: (ctx) => ctx.can('menu.view') && !!ctx.scope.brand,
    load: async (ctx) => ({ count: await Menu.countDocuments(ctx.scope) }),
}

const siteStatusWidget = {
    key: 'siteStatus',
    allowed: (ctx) => ctx.can('settings.general') && !!ctx.scope.brand,
    load: async (ctx) => {
        const brand = await Brand.findById(ctx.scope.brand).select('domains active').lean()
        const domain = brand?.domains?.find(
            (d) => String(d.country) === String(ctx.scope.country)
        )
        return {
            brandActive: brand?.active !== false,
            maintenance: !!domain?.maintenance_mode,
            ecommerceMaintenance: !!domain?.ecommerce_maintenance_mode,
        }
    },
}

// Audit log, admin accounts and site users have no privilege id on purpose:
// only super_admin and admin can see them (same rule as the audit log pages).
const activityWidget = {
    key: 'activity',
    allowed: (ctx) => ctx.fullAccess,
    load: async (ctx) => {
        const [items, failures24h] = await Promise.all([
            AuditLog.find({})
                .select('actor.name module action status entity.label created_at')
                .sort({ created_at: -1 })
                .limit(8)
                .lean(),
            AuditLog.countDocuments({
                status: 'failure',
                created_at: { $gte: subDays(ctx.now, 1) },
            }),
        ])
        return {
            failures24h,
            items: items.map((a) => ({
                id: a._id,
                actor: a.actor?.name || 'System',
                action: a.action,
                module: a.module,
                label: a.entity?.label || '',
                failed: a.status === 'failure',
                createdAgo: timeAgo(a.created_at),
            })),
        }
    },
}

const accountsWidget = {
    key: 'accounts',
    allowed: (ctx) => ctx.fullAccess,
    load: async (ctx) => {
        const notDeleted = { deleted: { $ne: true } }
        const [activeAdmins, inactiveAdmins, recentLogins, totalUsers, newUsers] =
            await Promise.all([
                Admin.countDocuments({ ...notDeleted, active: { $ne: false } }),
                Admin.countDocuments({ ...notDeleted, active: false }),
                Admin.find({ ...notDeleted, last_login_at: { $ne: null } })
                    .select('name role last_login_at')
                    .sort({ last_login_at: -1 })
                    .limit(5)
                    .lean(),
                User.countDocuments(notDeleted),
                User.countDocuments({ ...notDeleted, created_at: { $gte: subDays(ctx.now, 7) } }),
            ])
        return {
            activeAdmins,
            inactiveAdmins,
            totalUsers,
            newUsers,
            recentLogins: recentLogins.map((a) => ({
                name: a.name,
                role: (a.role || '').replace('_', ' '),
                lastLoginAgo: timeAgo(a.last_login_at),
            })),
        }
    },
}

const WIDGETS = [
    contentWidget,
    formsWidget,
    mediaWidget,
    menuWidget,
    siteStatusWidget,
    activityWidget,
    accountsWidget,
]

const quickActions = (ctx) => {
    const actions = ctx.manageableTypes
        .filter((t) => !t.single_type)
        .slice(0, 4)
        .map((t) => ({ label: `Add ${t.title}`, url: `/admin/cms/${t.slug}/add`, icon: 'fa-solid fa-plus' }))
    if (ctx.can('media.view')) {
        actions.push({ label: 'Media library', url: '/admin/cms/media', icon: 'fa-solid fa-photo-film' })
    }
    if (ctx.can('custom_forms.manage')) {
        actions.push({ label: 'New form', url: '/admin/custom-forms/add', icon: 'fa-solid fa-list-check' })
    }
    if (ctx.role === 'admin') {
        actions.push({ label: 'Manage users', url: '/admin/access-control/users', icon: 'fa-solid fa-user-shield' })
    }
    if (ctx.fullAccess) {
        actions.push({ label: 'Audit logs', url: '/admin/logs/audit', icon: 'fa-solid fa-clock-rotate-left' })
    }
    return actions
}

const basicDashboard = async (req, res) => {
    try {
        const ctx = await buildContext(req, res)
        const allowed = WIDGETS.filter((w) => w.allowed(ctx))

        // Load in parallel; one failing widget shouldn't take down the whole page
        const results = await Promise.all(
            allowed.map((w) =>
                w.load(ctx).catch((error) => {
                    logError(error)
                    return { error: true }
                })
            )
        )
        const widgets = Object.fromEntries(allowed.map((w, i) => [w.key, results[i]]))

        return res.render(`admin-njk/dashboards/basic`, {
            widgets,
            quickActions: quickActions(ctx),
            hasAnyWidget: allowed.length > 0,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/dashboards/basic`, {
            widgets: {},
            quickActions: [],
            hasAnyWidget: false,
            loadError: true,
        })
    }
}

module.exports = {
    basicDashboard,
}
