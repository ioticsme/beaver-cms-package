const mongoose = require('mongoose')
const { format } = require('date-fns')
const AuditLog = require('../../model/AuditLog')
const Admin = require('../../model/Admin')
const { logError } = require('../../helper/Logger.helper')
const { audit } = require('../../helper/AuditLog.helper')

const EXPORT_LIMIT = 50000

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Build a Mongo filter from the query string (shared by the table, export and page).
const buildFilter = (query = {}) => {
    const filter = {}
    if (query.admin && mongoose.isValidObjectId(query.admin)) {
        filter['actor.admin_id'] = new mongoose.Types.ObjectId(query.admin)
    }
    if (query.module) filter.module = String(query.module)
    if (query.action) filter.action = String(query.action)
    if (['success', 'failure'].includes(query.status)) filter.status = query.status
    if (query.entity_type) filter['entity.type'] = String(query.entity_type)
    if (query.entity_id) filter['entity.id'] = String(query.entity_id)
    if (query.ip) filter['request.ip'] = String(query.ip).trim()

    const from = query.from ? new Date(query.from) : null
    const to = query.to ? new Date(query.to) : null
    if ((from && !isNaN(from)) || (to && !isNaN(to))) {
        filter.created_at = {}
        if (from && !isNaN(from)) filter.created_at.$gte = from
        if (to && !isNaN(to)) {
            // include the whole "to" day when only a date is given
            if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setHours(23, 59, 59, 999)
            filter.created_at.$lte = to
        }
    }

    const q = (query.q || query.search?.value || '').trim()
    if (q) {
        const rx = new RegExp(escapeRegex(q.slice(0, 100)), 'i')
        filter.$or = [
            { 'actor.email': rx },
            { 'actor.name': rx },
            { 'entity.label': rx },
            { 'entity.id': rx },
            { 'request.url': rx },
            { 'request.ip': rx },
        ]
    }
    return filter
}

const list = async (req, res) => {
    try {
        const [modules, actions, admins] = await Promise.all([
            AuditLog.distinct('module'),
            AuditLog.distinct('action'),
            Admin.find({}).select('name email role deleted').sort({ name: 1 }).lean(),
        ])
        return res.render('admin-njk/logs/audit-log-list', {
            modules: modules.sort(),
            actions: actions.sort(),
            admins,
            filters: req.query,
        })
    } catch (error) {
        logError(error)
        return res.render('admin-njk/app-error-500')
    }
}

// Server-side DataTables endpoint
const jsonList = async (req, res) => {
    try {
        const draw = parseInt(req.query.draw) || 1
        const start = Math.max(parseInt(req.query.start) || 0, 0)
        const length = Math.min(Math.max(parseInt(req.query.length) || 25, 1), 250)
        const filter = buildFilter(req.query)
        const hasFilter = Object.keys(filter).length > 0

        const [rows, recordsTotal, recordsFiltered] = await Promise.all([
            AuditLog.find(filter)
                .select('-changes -request.body -meta.snapshot')
                .sort({ created_at: -1 })
                .skip(start)
                .limit(length)
                .lean(),
            AuditLog.estimatedDocumentCount(),
            hasFilter ? AuditLog.countDocuments(filter) : null,
        ])

        return res.status(200).json({
            draw,
            recordsTotal,
            recordsFiltered: hasFilter ? recordsFiltered : recordsTotal,
            data: rows,
        })
    } catch (error) {
        logError(error)
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const detail = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.render('admin-njk/page-error-404')
        }
        const log = await AuditLog.findById(req.params.id).lean()
        if (!log) {
            return res.render('admin-njk/page-error-404')
        }
        // Other entries for the same record, newest first
        const related = log.entity?.id
            ? await AuditLog.find({
                  'entity.id': log.entity.id,
                  _id: { $ne: log._id },
              })
                  .select('actor module action status created_at')
                  .sort({ created_at: -1 })
                  .limit(20)
                  .lean()
            : []
        return res.render('admin-njk/logs/audit-log-detail', {
            log,
            related,
            prettyJson: (v) => JSON.stringify(v, null, 2),
        })
    } catch (error) {
        logError(error)
        return res.render('admin-njk/app-error-500')
    }
}

const csvCell = (value) => {
    if (value === undefined || value === null) return ''
    let str = typeof value === 'object' ? JSON.stringify(value) : String(value)
    // Stop spreadsheet formula injection
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`
    return `"${str.replace(/"/g, '""')}"`
}

const exportCsv = async (req, res) => {
    try {
        const filter = buildFilter(req.query)
        audit(req, {
            module: 'audit_log',
            action: 'export',
            meta: { filter: req.query },
        })

        const fileName = `audit-log-${format(new Date(), 'yyyyMMdd-HHmmss')}.csv`
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)

        const header = [
            'Date (UTC)',
            'Admin',
            'Email',
            'Role',
            'Module',
            'Action',
            'Status',
            'Entity type',
            'Entity id',
            'Entity',
            'IP',
            'Forwarded for',
            'User agent',
            'Method',
            'URL',
            'Brand',
            'Country',
            'Changes',
            'Meta',
        ]
        res.write('﻿' + header.map(csvCell).join(',') + '\n')

        const cursor = AuditLog.find(filter)
            .sort({ created_at: -1 })
            .limit(EXPORT_LIMIT)
            .lean()
            .cursor()

        for await (const log of cursor) {
            const row = [
                log.created_at?.toISOString(),
                log.actor?.name,
                log.actor?.email,
                log.actor?.role,
                log.module,
                log.action,
                log.status,
                log.entity?.type,
                log.entity?.id,
                log.entity?.label,
                log.request?.ip,
                log.request?.forwarded_for,
                log.request?.user_agent,
                log.request?.method,
                log.request?.url,
                log.brand?.code,
                log.brand?.country_code,
                (log.changes || []).map((c) => c.path).join(', '),
                log.meta,
            ]
            res.write(row.map(csvCell).join(',') + '\n')
        }
        return res.end()
    } catch (error) {
        logError(error)
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Something went wrong' })
        }
        return res.end()
    }
}

module.exports = {
    list,
    jsonList,
    detail,
    exportCsv,
    buildFilter,
}
