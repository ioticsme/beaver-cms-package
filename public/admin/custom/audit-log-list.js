;(function () {
    'use strict'

    var esc = function (value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
    }

    var currentFilters = function () {
        var form = document.getElementById('audit_filter_form')
        var params = new URLSearchParams()
        new FormData(form).forEach(function (value, key) {
            if (value) params.append(key, value)
        })
        return params
    }

    var actionBadge = function (action, status) {
        var cls = 'badge-light-primary'
        if (status === 'failure') cls = 'badge-light-danger'
        else if (/delete/.test(action)) cls = 'badge-light-danger'
        else if (/create|upload|duplicate|publish$/.test(action)) cls = 'badge-light-success'
        else if (/login|logout|signup/.test(action)) cls = 'badge-light-info'
        else if (/update|status|activate|change/.test(action)) cls = 'badge-light-warning'
        return (
            '<span class="badge ' + cls + '">' + esc(action) + '</span>' +
            (status === 'failure' ? ' <span class="badge badge-danger">failed</span>' : '')
        )
    }

    var dt = $('#audit_logs_datatable').DataTable({
        searching: false,
        processing: true,
        serverSide: true,
        ordering: false,
        lengthMenu: [10, 25, 50, 100, 250],
        pageLength: 25,
        ajax: {
            url: '/admin/logs/audit/json',
            data: function (d) {
                currentFilters().forEach(function (value, key) {
                    d[key] = value
                })
            },
        },
        columns: [
            { data: 'created_at' },
            { data: 'actor' },
            { data: 'module' },
            { data: 'action' },
            { data: 'entity' },
            { data: 'request' },
            { data: 'brand' },
            { data: '_id', className: 'text-end' },
        ],
        columnDefs: [
            {
                targets: 0,
                render: function (data) {
                    if (!data) return ''
                    var d = new Date(data)
                    return (
                        '<span title="' + esc(d.toISOString()) + '">' +
                        esc(d.toLocaleString()) + '</span>'
                    )
                },
            },
            {
                targets: 1,
                render: function (actor) {
                    actor = actor || {}
                    return (
                        '<div class="fw-bold text-gray-800">' + esc(actor.name || '—') + '</div>' +
                        '<div class="text-muted fs-8">' + esc(actor.email || '') +
                        (actor.role ? ' · ' + esc(actor.role) : '') + '</div>'
                    )
                },
            },
            {
                targets: 2,
                render: function (data) {
                    return '<code>' + esc(data) + '</code>'
                },
            },
            {
                targets: 3,
                render: function (data, type, row) {
                    return actionBadge(data, row.status)
                },
            },
            {
                targets: 4,
                render: function (entity) {
                    entity = entity || {}
                    if (!entity.id && !entity.label) return '<span class="text-muted">—</span>'
                    return (
                        '<div class="text-gray-800">' + esc(entity.label || entity.id) + '</div>' +
                        '<div class="text-muted fs-8">' + esc(entity.type || '') +
                        (entity.id ? ' · ' + esc(entity.id) : '') + '</div>'
                    )
                },
            },
            {
                targets: 5,
                render: function (request) {
                    return esc((request || {}).ip || '')
                },
            },
            {
                targets: 6,
                render: function (brand) {
                    brand = brand || {}
                    return esc([brand.code, brand.country_code].filter(Boolean).join(' / '))
                },
            },
            {
                targets: 7,
                render: function (id) {
                    return (
                        '<a class="btn btn-sm btn-light-primary" href="/admin/logs/audit/view/' +
                        esc(id) + '">View</a>'
                    )
                },
            },
        ],
    })

    document.getElementById('audit_filter_form').addEventListener('submit', function (e) {
        e.preventDefault()
        window.history.replaceState(null, '', '/admin/logs/audit?' + currentFilters().toString())
        dt.ajax.reload()
    })

    document.getElementById('audit_export_btn').addEventListener('click', function (e) {
        e.preventDefault()
        window.location.href = '/admin/logs/audit/export?' + currentFilters().toString()
    })
})()
