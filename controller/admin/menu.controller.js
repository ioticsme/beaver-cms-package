const envConfig = require('../../config/env.config')
const Joi = require('joi')
const _ = require('lodash')
const Menu = require('../../model/Menu')
const collect = require('collect.js')
const { Types } = require('mongoose')

// Function to list all menu items based on the authenticated user's brand and country
const listMenu = async (req, res) => {
    try {
        // Find menus associated with the user's brand and country, sorted by position
        const menus = await Menu.find({
            brand: req.authUser?.brand?._id,
            country: req.authUser?.brand?.country,
            deleted: { $ne: true },
        }).sort({ position: 1 })

        // Render the menu listing page and pass the found menus
        res.render(`admin-njk/cms/menu/listing`, { menulist: menus })
    } catch (e) {
        console.log(e)
        return res.render(`admin-njk/app-error-500`) // Handle errors by rendering error page
    }
}

// Function to add a new menu section
const addSection = async (req, res) => {
    try {
        const schema = Joi.object({
            menu_position: Joi.string().required(), // Validate that menu_position is required
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false, // Validate all fields before throwing an error
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error) // Return validation error if schema doesn't pass
        }

        let body = req.body

        // Check if the menu section already exists for the user's brand and country
        let isExist = await Menu.findOne({
            brand: req.authUser?.brand?._id,
            country: req.authUser?.brand?.country,
            nav_position: body.menu_position,
            deleted: { $ne: true },
        })

        if (isExist) {
            return res
                .status(400)
                .json({ error: 'Menu section already exists' })
        }

        // Create new menu section if it doesn't already exist
        await Menu.create({
            nav_label: body.menu_position,
            nav_position: body.menu_position,
            brand: req.authUser?.brand?._id,
            country: req.authUser?.brand?.country,
        })

        return res.status(200).json({
            message: `New Menu Section added`,
            redirect_to: '/admin/cms/menu', // Redirect to the menu list page after success
        })
    } catch (error) {
        console.log(error)
        return res.status(400).json({ error: 'Something went wrong' }) // Handle errors gracefully
    }
}

// Function to add a new menu item
const addMenu = async (req, res) => {
    try {
        let labelValidationObj = {}
        let pathValidationObj = {}

        // Create validation objects for each language the brand supports
        req.authUser.brand.languages.forEach((lang) => {
            _.assign(labelValidationObj, {
                [lang.prefix]: eval(`Joi.string().required()`), // Require label for each language
            })
            _.assign(pathValidationObj, {
                [lang.prefix]: eval(`Joi.string().required()`), // Require path for each language
            })
        })

        // Schema validation for the request body
        const schema = Joi.object({
            label: Joi.object({
                ...labelValidationObj,
            }),
            path: Joi.object({
                ...pathValidationObj,
            }),
            active: Joi.string().allow('', null, 'true'), // Allow empty or 'true' for external links
            external: Joi.string().allow('', null, 'true'), // Allow empty or 'true' for external links
            menu_position: Joi.string().optional().allow(null, ''), // Menu position is optional
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false, // Validate all fields before throwing an error
        })

        if (validationResult.error) {
            res.status(422).json(validationResult.error) // Return validation error if schema fails
            return
        }

        let body = req.body
        let label = {}
        let path = {}

        // Assign language-specific labels and paths to the corresponding objects
        req.authUser.brand.languages.forEach((lang) => {
            _.assign(label, {
                [lang.prefix]: body.label[lang.prefix],
            })
            _.assign(path, {
                [lang.prefix]: body.path[lang.prefix],
            })
        })

        // Object to insert into the menu
        const obj = {
            _id: Types.ObjectId(),
            label,
            url: path,
            external: body.external == 'true', // Check if the link is external
            active: body.active == 'true', // Check if the link is active
        }

        // Find the corresponding menu position to add the new menu item
        const nav = await Menu.findOne({
            _id: body.menu_position,
            deleted: { $ne: true },
        })

        if (!nav) {
            return res.status(400).json({ error: 'Nav not found' }) // Return error if nav position is invalid
        }

        // Push the new menu item into the existing menu's nav_items array
        const update = await Menu.findOneAndUpdate(
            {
                _id: body.menu_position,
                deleted: { $ne: true },
            },
            {
                $push: {
                    nav_items: obj,
                },
            }
        )

        // Check if update was successful
        if (!update?._id) {
            return res
                .status(400)
                .json({ error: 'Select a valid Menu position' })
        }

        return res.status(200).json({
            message: `New Menu added`,
            item: update,
            redirect_to: '/admin/cms/menu', // Redirect to menu list on success
        })
    } catch (error) {
        console.log(error)
        return res.status(400).json({ error: 'Something went wrong' }) // Handle errors
    }
}

// Function to edit an existing menu item
const editMenu = async (req, res) => {
    try {
        let { position, index, level } = req.params
        let parentIndex = req.query?.parent_index
        let secParentIndex = req.query?.sec_parent_index

        // Find menus based on user's brand and country, sorted by position
        const menus = await Menu.find({
            brand: req.authUser?.brand?._id,
            country: req.authUser?.brand?.country,
            deleted: { $ne: true },
        }).sort({ position: 1 })

        // Find the specific menu based on position
        const menuDetail = menus.find((menu) => menu.nav_position == position)
        let menuItem = {}

        // Find the menu item at the correct level (0, 1, or 2)
        if (menuDetail?._id) {
            if (level == '0') {
                menuItem = menuDetail.nav_items?.at(index) // Level 0 item
            } else if (level == '1') {
                menuItem = menuDetail.nav_items[parentIndex]?.child?.at(index) // Level 1 child item
                if (menuItem) menuItem.parent_index = req.query.parent_index
            } else if (level == '2') {
                menuItem =
                    menuDetail.nav_items[parentIndex]?.child[
                        secParentIndex
                    ]?.child?.at(index) // Level 2 child item
                if (menuItem) {
                    menuItem.parent_index = req.query.parent_index
                    menuItem.sec_parent_index = req.query.sec_parent_index
                }
            }
        }

        // Add level value to the menu item for rendering
        if (menuItem?.active) {
            menuItem.level = level
            menuItem.index = `${index}`
        }

        // Render the menu edit form with the found menu item
        res.render(`admin-njk/cms/menu/edit-form`, {
            menulist: menus,
            navPosition: position,
            menuItem: menuItem ? menuItem : {},
        })
    } catch (error) {
        console.log(error)
        return res.render(`admin-njk/app-error-500`) // Handle errors
    }
}

const saveEditMenu = async (req, res) => {
    try {
        const session = req.authUser
        let labelValidationObj = {}
        let pathValidationObj = {}
        req.authUser.brand.languages.forEach((lang) => {
            _.assign(labelValidationObj, {
                [lang.prefix]: eval(`Joi.string().required()`),
            })
            _.assign(pathValidationObj, {
                [lang.prefix]: eval(`Joi.string().required()`),
            })
        })
        const schema = Joi.object({
            index: Joi.string().required(),
            level: Joi.string().required(),
            parent_index: Joi.optional(),
            sec_parent_index: Joi.optional(),
            label: Joi.object({
                ...labelValidationObj,
            }),
            path: Joi.object({
                ...pathValidationObj,
            }),
            external: Joi.string().allow('', null, 'true'),
            active: Joi.string().allow('', null, 'true'),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }
        // Destructuring values from req.body
        const { index, level } = req.body
        const { position } = req.params

        let update
        let body = req.body
        let label = {}
        let path = {}
        req.authUser.brand.languages.forEach((lang) => {
            _.assign(label, {
                [lang.prefix]: body.label[lang.prefix],
            })
            _.assign(path, {
                [lang.prefix]: body.path[lang.prefix],
            })
        })
        // Checking the level of the child
        if (level == '0') {
            // Find menu with position
            // FInding the menu item with child level and index of the menu item in child array
            // After finding delete the menu item from the child array then push the new menu item to the index position
            const menu = await Menu.findOne({
                brand: req.authUser?.brand?._id,
                country: req.authUser?.brand?.country,
                nav_position: position,
                deleted: { $ne: true },
            })
            let menuItem = {}
            let menuIndex = 0
            if (menu?._id) {
                menuItem = menu.nav_items.at(index)
                menuIndex = index
            }
            let obj = {
                label,
                url: path,
                external: req.body.external == 'true',
                active: req.body.active == 'true',
                child: menuItem.child,
            }

            update = await Menu.findOneAndUpdate(
                {
                    nav_position: position,
                    brand: req.authUser?.brand?._id,
                    country: req.authUser?.brand?.country,
                    deleted: { $ne: true },
                },
                { $set: { [`nav_items.${menuIndex}`]: obj } },
                {
                    new: true,
                }
            )
        } else if (level == '1') {
            const menu = await Menu.findOne({
                nav_position: position,
                brand: req.authUser?.brand?._id,
                country: req.authUser?.brand?.country,
                deleted: { $ne: true },
            })
            let menuItem = {}
            let menuIndex
            if (menu?._id) {
                menuItem = menu.nav_items[body.parent_index].child?.at(index)
                menuIndex = index
            }

            let obj = {
                label,
                url: path,
                external: req.body.external == 'true',
                active: req.body.active == 'true',
                child: menuItem.child,
            }

            update = await Menu.findOneAndUpdate(
                {
                    nav_position: position,
                    brand: req.authUser?.brand?._id,
                    country: req.authUser?.brand?.country,
                    deleted: { $ne: true },
                },
                {
                    $set: {
                        [`nav_items.${body.parent_index}.child.${menuIndex}`]:
                            obj,
                    },
                },
                {
                    new: true,
                }
            )
        } else if (level == '2') {
            const menu = await Menu.findOne({
                nav_position: position,
                brand: req.authUser?.brand?._id,
                country: req.authUser?.brand?.country,
                deleted: { $ne: true },
            })
            let menuItem = {}
            let menuIndex
            if (menu?._id) {
                menuItem =
                    menu.nav_items[body.parent_index].child[
                        body.sec_parent_index
                    ].child?.at(index)
                menuIndex = index
            }

            let obj = {
                label,
                url: path,
                external: req.body.external == 'true',
                active: req.body.active == 'true',
                child: menuItem.child,
            }

            update = await Menu.findOneAndUpdate(
                {
                    nav_position: position,
                    brand: req.authUser?.brand?._id,
                    country: req.authUser?.brand?.country,
                    deleted: { $ne: true },
                },
                {
                    $set: {
                        [`nav_items.${body.parent_index}.child.${body.sec_parent_index}.child.${menuIndex}`]:
                            obj,
                    },
                },
                {
                    new: true,
                }
            )
        }

        // If menu  not found
        if (!update?._id) {
            return res.status(400).json({ error: 'Select a valid Menu ' })
        }

        return res.status(200).json({
            message: `Menu updated`,
        })
    } catch (error) {
        console.log(error)
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const deletePosition = async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.string().required(),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json({ error: 'Something went wrong' })
        }
        // Destructuring values from req.body
        const { id } = req.body

        await Menu.updateOne(
            {
                _id: id,
                deleted: { $ne: true },
            },
            {
                deleted: true,
                deleted_at: new Date(),
            }
        )

        return res.status(200).json({
            message: `Menu Section deleted`,
        })
    } catch (error) {
        console.log('error :>> ', error)
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

const deleteMenu = async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.string().required(),
            nav_position: Joi.string().required(),
            level: Joi.string().required(),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json({ error: 'Something went wrong' })
        }
        // Destructuring values from req.body
        const { id, nav_position, level } = req.body

        let update
        // Checking the level of the child
        if (level == '0') {
            update = await Menu.findOneAndUpdate(
                {
                    nav_position,
                    brand: req.authUser?.brand?._id,
                    country: req.authUser?.brand?.country,
                    deleted: { $ne: true },
                },
                {
                    $pull: {
                        nav_items: {
                            _id: id,
                        },
                    },
                }
            )
        } else if (level == '1') {
            update = await Menu.findOneAndUpdate(
                {
                    nav_position,
                    brand: req.authUser?.brand?._id,
                    country: req.authUser?.brand?.country,
                    deleted: { $ne: true },
                },
                {
                    $pull: {
                        [`nav_items.$[].child`]: {
                            _id: id,
                        },
                    },
                }
            )
        } else if (level == '2') {
            update = await Menu.findOneAndUpdate(
                {
                    nav_position,
                    brand: req.authUser?.brand?._id,
                    country: req.authUser?.brand?.country,
                    deleted: { $ne: true },
                },
                {
                    $pull: {
                        [`nav_items.$[].child.$[].child`]: {
                            _id: id,
                        },
                    },
                }
            )
        }
        // If menu  not found
        if (!update?._id) {
            return res.status(400).json({ error: 'Select a valid Menu ' })
        }

        return res.status(200).json({
            message: `Menu deleted`,
        })
    } catch (error) {
        console.log('error :>> ', error)
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

// Handle position change of menu items
const saveMenu = async (req, res) => {
    try {
        let navName = req.body.name
        if (!navName) {
            return res.status(400).json({ error: 'Invalid data' })
        }
        // console.log(req.body.menu)
        const dataToSave = []
        const treeData = collect(JSON.parse(req.body.menu))
        const root_items = treeData.where('parent', '#').all()
        root_items.forEach((rootElement, rootIndex) => {
            const parent = {
                _id: rootElement.li_attr.data_id,
                position: rootIndex,
                label: JSON.parse(rootElement.li_attr.label),
                url: JSON.parse(rootElement.li_attr.url),
                active: JSON.parse(rootElement.li_attr.active == 'true'),
                external: JSON.parse(rootElement.li_attr.external == 'true'),
            }
            parent.child = []
            treeData
                .where('parent', rootElement.id)
                .all()
                .forEach((firstChildElement, fcIndex) => {
                    const firstChild = {
                        _id: firstChildElement.li_attr.data_id,
                        position: fcIndex,
                        label: JSON.parse(firstChildElement.li_attr.label),
                        url: JSON.parse(firstChildElement.li_attr.url),
                        active: JSON.parse(
                            firstChildElement.li_attr.active == 'true'
                        ),
                        external: JSON.parse(
                            firstChildElement.li_attr.external == 'true'
                        ),
                    }
                    firstChild.child = []
                    treeData
                        .where('parent', firstChildElement.id)
                        .all()
                        .forEach((secondChildElement, scIndex) => {
                            const secondChild = {
                                _id: secondChildElement.li_attr.data_id,
                                position: scIndex,
                                label: JSON.parse(
                                    secondChildElement.li_attr.label
                                ),
                                url: JSON.parse(secondChildElement.li_attr.url),
                                active: JSON.parse(
                                    secondChildElement.li_attr.active == 'true'
                                ),
                                external: JSON.parse(
                                    secondChildElement.li_attr.external ==
                                        'true'
                                ),
                            }
                            firstChild.child.push(secondChild)
                        })
                    parent.child.push(firstChild)
                })
            dataToSave.push(parent)
        })

        const save = await Menu.findOneAndUpdate(
            {
                nav_position: navName,
                brand: req.authUser?.brand?._id,
                country: req.authUser?.brand?.country,
                deleted: { $ne: true },
            },
            {
                $set: {
                    nav_items: dataToSave,
                },
            }
        )
        if (!save?._id) {
            return res.status(400).json({ error: 'Menu not found' })
        }
        return res.status(200).json({
            message: `Menu position changed`,
            item: save,
        })
    } catch (error) {
        console.log(error)
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

module.exports = {
    listMenu,
    addSection,
    addMenu,
    editMenu,
    saveEditMenu,
    deletePosition,
    deleteMenu,
    saveMenu,
}
