const ContentType = require('../model/ContentType')

const getCmsRoutes = async (req) => {
    const cmsChildRoutes = []
    const contentTypes = await ContentType.find({
        brand: req.session?.brand?._id,
        active: true,
    }).sort({ position: 1 })

    contentTypes.forEach((item) => {
        cmsChildRoutes.push({
            id: `cms.${item.slug}`,
            text: item.title,
            children: [
                {
                    id: `${item.slug}.view`,
                    text: 'View',
                    urls: [
                        `/admin/cms/${item.slug}`,
                        `/admin/cms/${item.slug}/detail/:id`,
                    ],
                },
                {
                    id: `${item.slug}.manage`,
                    text: 'Manage',
                    urls: [
                        `/admin/cms/${item.slug}/add`,
                        `/admin/cms/${item.slug}/edit/:id`,
                        `/admin/cms/${item.slug}/save`,
                        `/admin/cms/${item.slug}/delete`,
                        `/admin/cms/${item.slug}/change-status`,
                        `/admin/cms/${item.slug}/editor/load-data/:id`,
                        `/admin/cms/${item.slug}/editor/:id`,
                        `/admin/cms/${item.slug}/editor/save`,
                    ],
                },
            ],
        })
    })

    cmsChildRoutes
        .push
        // {
        //     id: `cms.media`,
        //     text: 'Media',
        //     children: [
        //         {
        //             id: `media.view`,
        //             text: 'View',
        //             urls: [`/cms/media`],
        //         },
        //         {
        //             id: `media.manage`,
        //             text: 'Manage',
        //             urls: [
        //                 `/cms/media/add-meta`,
        //                 `/cms/media/json`,
        //                 `/cms/media/view/:id`,
        //                 `/cms/media/upload`,
        //                 `/cms/media/delete`,
        //                 `/cms/media/ck-editor/upload`,
        //             ],
        //         },
        //     ],
        // },
        // {
        //     id: `cms.menu`,
        //     text: 'Menu',
        //     children: [
        //         {
        //             id: `menu.view`,
        //             text: 'View',
        //             urls: [`/cms/menu`],
        //         },
        //         {
        //             id: `menu.manage`,
        //             text: 'Manage',
        //             urls: [
        //                 `/cms/menu/section/add`,
        //                 `/cms/menu/add`,
        //                 `/cms/menu/:position/edit`,
        //                 `/cms/menu/:position/edit/:index/:level`,
        //                 `/cms/menu/delete-position`,
        //                 `/cms/menu/delete`,
        //                 `/cms/menu/save`,
        //             ],
        //         },
        //     ],
        // }
        // {
        //     id: `cms.forms`,
        //     text: 'Forms',
        //     children: [
        //         {
        //             id: `forms.view`,
        //             text: 'View',
        //             urls: [`/cms/forms`],
        //         },
        //         {
        //             id: `forms.manage`,
        //             text: 'Manage',
        //             urls: [`/cms/forms/add`, `/cms/forms/save`],
        //         },
        //     ],
        // }
        ()

    // console.log(cmsChildRoutes[0].children)
    return cmsChildRoutes
}

let privileges = async (req) => [
    {
        id: '0',
        text: 'Dashboard',
        section: 'dashboard',
        children: [
            {
                id: 'dashboard.page',
                text: 'Dashboard Page',
                urls: ['/admin/dashboard'],
            },
        ],
    },
    {
        id: '2',
        text: 'CMS',
        section: 'content',
        children: await getCmsRoutes(req),
    },
    {
        id: '3',
        text: 'Assets',
        section: 'assets',
        children: [
            {
                id: `cms.media`,
                text: 'Media',
                children: [
                    {
                        id: `media.view`,
                        text: 'View',
                        urls: [`/admin/cms/media`],
                    },
                    {
                        id: `media.manage`,
                        text: 'Manage',
                        urls: [
                            `/admin/cms/media/add-meta`,
                            `/admin/cms/media/json`,
                            `/admin/cms/media/view/:id`,
                            `/admin/cms/media/upload`,
                            `/admin/cms/media/delete`,
                            `/admin/cms/media/ck-editor/upload`,
                        ],
                    },
                ],
            },
            {
                id: `cms.menu`,
                text: 'Menu',
                children: [
                    {
                        id: `menu.view`,
                        text: 'View',
                        urls: [`/admin/cms/menu`],
                    },
                    {
                        id: `menu.manage`,
                        text: 'Manage',
                        urls: [
                            `/admin/cms/menu/section/add`,
                            `/admin/cms/menu/add`,
                            `/admin/cms/menu/:position/edit`,
                            `/admin/cms/menu/:position/edit/:index/:level`,
                            `/admin/cms/menu/delete-position`,
                            `/admin/cms/menu/delete`,
                            `/admin/cms/menu/save`,
                        ],
                    },
                ],
            },
        ],
    },
    {
        id: '4',
        text: 'Custom Forms',
        section: 'custom-forms',
        children: [
            {
                id: 'custom_forms.view',
                text: 'View',
                urls: ['/admin/custom-forms'],
            },
            {
                id: 'custom_forms.manage',
                text: 'Manage',
                urls: [
                    '/admin/custom-forms/add',
                    '/admin/custom-forms/edit/:id',
                    '/admin/custom-forms/save',
                    '/admin/custom-forms/change-status',
                    '/admin/custom-forms/delete',
                    '/admin/custom-forms/duplicate',
                ],
            },
            {
                id: 'custom_forms.data',
                text: 'Data Manage',
                urls: [
                    '/admin/custom-forms/submissions/:id',
                    '/admin/custom-forms/submissions/:id/export',
                    '/admin/custom-forms/submissions/:formId/:formDataId',
                ],
            },
        ],
    },
    {
        id: '5',
        text: 'Settings',
        section: 'settings',
        children: [
            {
                id: 'settings.general',
                text: 'General',
                urls: [
                    '/admin/settings/general',
                    '/admin/settings/general/clear-cache',
                    '/admin/settings/general/brand/change-status',
                    '/admin/settings/general/brand/change-logo',
                    '/admin/settings/general/brand/change-logo/:id',
                    '/admin/settings/general/switch-brand',
                    '/admin/settings/general/save-fbcm-token',
                ],
            },
            {
                id: 'settings.seo',
                text: 'SEO',
                urls: [
                    '/admin/settings/seo',
                    '/admin/settings/seo/edit',
                    '/admin/settings/seo/save',
                ],
            },
            // {
            //     id: 'settings.ecommerce',
            //     text: 'Ecommerce',
            //     urls: [
            //         '/admin/settings/ecommerce',
            //         '/admin/settings/ecommerce/invoice/edit',
            //         '/admin/settings/ecommerce/invoice/save',
            //     ],
            // },
        ],
    },
]

module.exports = { privileges }
