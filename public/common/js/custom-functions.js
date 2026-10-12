// Delete
function deleteItem(element) {
    const id = element.getAttribute('id')
    const url = element.getAttribute('url')

    Swal.fire({
        text: 'Are you sure you want to delete ?',
        icon: 'warning',
        showCancelButton: !0,
        buttonsStyling: !1,
        confirmButtonText: 'Yes, delete!',
        cancelButtonText: 'No, cancel',
        customClass: {
            confirmButton: 'btn fw-bold btn-danger',
            cancelButton: 'btn fw-bold btn-active-light-primary',
        },
    }).then((e) => {
        if (e.value) {
            fetch(url, {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id,
                }),
            })
                .then(async (res) => {
                    const status = res.status
                    let data = await res.json()
                    if (status >= 200 && status < 300) {
                        // Swal.fire({
                        //     text: data.message || 'You have deleted  !.',
                        //     icon: 'success',
                        //     buttonsStyling: !1,
                        //     confirmButtonText: 'Ok',
                        //     customClass: {
                        //         confirmButton: 'btn fw-bold btn-primary',
                        //     },
                        // }).then((e) => {
                            location.reload()
                        // })
                    } else {
                        // Swal.fire({
                        //     text: data.error || 'Something went wrong !.',
                        //     icon: 'warning',
                        //     buttonsStyling: !1,
                        //     confirmButtonText: 'Ok, got it!',
                        //     customClass: {
                        //         confirmButton: 'btn fw-bold btn-primary',
                        //     },
                        // })
                    }
                })
                .catch((err) => {
                    Swal.fire({
                        text: 'Something went wrong !.',
                        icon: 'warning',
                        buttonsStyling: !1,
                        confirmButtonText: 'Ok, got it!',
                        customClass: {
                            confirmButton: 'btn fw-bold btn-primary',
                        },
                    })
                })
        }
    })
}
//- Duplicate item, then open the copy if the server returns a redirect
function duplicateItem(element) {
    const id = element.getAttribute('id')
    const url = element.getAttribute('url')

    const showError = (text) =>
        Swal.fire({
            text: text || 'Something went wrong !.',
            icon: 'warning',
            buttonsStyling: !1,
            confirmButtonText: 'Ok, got it!',
            customClass: {
                confirmButton: 'btn fw-bold btn-primary',
            },
        })

    Swal.fire({
        text: 'Are you sure you want to duplicate this item ?',
        icon: 'question',
        showCancelButton: !0,
        buttonsStyling: !1,
        confirmButtonText: 'Yes, duplicate!',
        cancelButtonText: 'No, cancel',
        customClass: {
            confirmButton: 'btn fw-bold btn-primary',
            cancelButton: 'btn fw-bold btn-active-light-primary',
        },
    }).then((e) => {
        if (e.value) {
            fetch(url, {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id,
                }),
            })
                .then(async (res) => {
                    const status = res.status
                    let data = await res.json()
                    if (status >= 200 && status < 300) {
                        if (data.redirect) {
                            location.href = data.redirect
                        } else {
                            location.reload()
                        }
                    } else {
                        showError(data.error)
                    }
                })
                .catch(() => showError())
        }
    })
}
//- Change  status
function changeStatus(element, status) {
    const id = element.getAttribute('id')
    const url = element.getAttribute('url')
    fetch(url, {
        method: 'POST',
        cache: 'no-cache',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            id,
            status,
        }),
    })
        .then(async (res) => {
            const status = res.status
            let data = await res.json()
            if (status >= 200 && status < 300) {
                location.reload()
            } else {
                Swal.fire({
                    text: data.error || 'Something went wrong !.',
                    icon: 'warning',
                    buttonsStyling: !1,
                    confirmButtonText: 'Ok, got it!',
                    customClass: {
                        confirmButton: 'btn fw-bold btn-primary',
                    },
                })
            }
        })
        .catch((err) => {
            Swal.fire({
                text: 'Something went wrong !.',
                icon: 'warning',
                buttonsStyling: !1,
                confirmButtonText: 'Ok, got it!',
                customClass: {
                    confirmButton: 'btn fw-bold btn-primary',
                },
            })
        })
}

function mediaConfigFormSwitching(element) {
    document.querySelectorAll('.media-config-form').forEach((media_config) => {
        media_config.classList.add('d-none')
    })
    if (element.value == 'imagekit') {
        document
            .getElementById('imagekit_config_form')
            .classList.remove('d-none')
    } else if (element.value == 'cloudinary') {
        document
            .getElementById('cloudinary_config_form')
            .classList.remove('d-none')
    } else if (element.value == 'azure_blob') {
        document
            .getElementById('azure_blob_config_form')
            .classList.remove('d-none')
    } else if (element.value == 's3') {
        document
            .getElementById('s3_config_form')
            .classList.remove('d-none')
    }
}
function emailConfigFormSwitching(element) {
    document.querySelectorAll('.email-config-form').forEach((media_config) => {
        media_config.classList.add('d-none')
    })
    if (element.value == 'mailgun') {
        document
            .getElementById('mailgun_config_form')
            .classList.remove('d-none')
    } else if (element.value == 'sendgrid') {
        document
            .getElementById('sendgrid_config_form')
            .classList.remove('d-none')
    } else if (element.value == 'local') {
        document
            .getElementById('localmail_config_form')
            .classList.remove('d-none')
    }
}
