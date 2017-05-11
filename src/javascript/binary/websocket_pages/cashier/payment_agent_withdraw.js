const BinarySocket = require('../socket');
const Client       = require('../../base/client');
const localize     = require('../../base/localize').localize;
const FormManager  = require('../../common_functions/form_manager');
const Cookies      = require('../../../lib/js-cookie');

const PaymentAgentWithdraw = (() => {
    'use strict';

    const view_ids = {
        error  : '#viewError',
        success: '#viewSuccess',
        confirm: '#viewConfirm',
        form   : '#viewForm',
    };
    const field_ids = {
        verification_code: '#verification_code',
        ddl_agents       : '#ddlAgents',
        txt_amount       : '#txtAmount',
        txt_desc         : '#txtDescription',
    };

    let $views,
        agent_name;

    // -----------------------
    // ----- Agents List -----
    // -----------------------
    const populateAgentsList = (response) => {
        const $ddl_agents = $(field_ids.ddl_agents);
        $ddl_agents.empty();
        const pa_list = (response.paymentagent_list || {}).list;
        if (pa_list.length > 0) {
            BinarySocket.send({ verify_email: Client.get('email'), type: 'paymentagent_withdraw' });
            insertListOption($ddl_agents, localize('Please select a payment agent'), '');
            for (let i = 0; i < pa_list.length; i++) {
                insertListOption($ddl_agents, pa_list[i].name, pa_list[i].paymentagent_loginid);
            }
            setActiveView(view_ids.form);
            const form_id = `#${$(view_ids.form).find('form').attr('id')}`;
            FormManager.init(form_id, [
                { selector: field_ids.ddl_agents,        validations: ['req'], request_field: 'paymentagent_loginid' },
                { selector: field_ids.txt_amount,        validations: ['req', ['number', { type: 'float', decimals: '1, 2', min: 10, max: 2000 }]], request_field: 'amount' },
                { selector: field_ids.txt_desc,          validations: ['general'], request_field: 'description' },
                { selector: field_ids.verification_code, validations: ['req', 'email_token'] },

                { request_field: 'currency',              value: 'USD' },
                { request_field: 'paymentagent_withdraw', value: 1 },
                { request_field: 'dry_run',               value: 1 },
            ]);

            FormManager.handleSubmit({
                form_selector       : form_id,
                fnc_response_handler: withdrawResponse,
                fnc_additional_check: setAgentName,
            });
        } else {
            showPageError(localize('The Payment Agent facility is currently not available in your country.'));
        }
    };

    const insertListOption = ($ddl_object, item_text, item_value) => {
        $ddl_object.append($('<option/>', { value: item_value, text: item_text }));
    };

    // ----------------------------
    // ----- Withdraw Process -----
    // ----------------------------
    const withdrawResponse = (response) => {
        const request = response.echo_req;
        switch (response.paymentagent_withdraw) {
            case 2: { // dry_run success: showing the confirmation page
                setActiveView(view_ids.confirm);

                $('#lblAgentName').text(agent_name);
                $('#lblCurrency').text(request.currency);
                $('#lblAmount').text(request.amount);

                FormManager.init(view_ids.confirm, [
                    { request_field: 'paymentagent_loginid',  value: request.paymentagent_loginid },
                    { request_field: 'amount',                value: request.amount },
                    { request_field: 'description',           value: request.description },
                    { request_field: 'verification_code',     value: request.verification_code },
                    { request_field: 'currency',              value: request.currency },
                    { request_field: 'paymentagent_withdraw', value: 1 },
                ]);

                FormManager.handleSubmit({
                    form_selector       : view_ids.confirm,
                    fnc_response_handler: withdrawResponse,
                });

                $(`${view_ids.confirm} #btnBack`).click(() => {
                    setActiveView(view_ids.form);
                });
                break;
            }
            case 1: // withdrawal success
                setActiveView(view_ids.success);
                $('#successMessage').css('display', '')
                    .attr('class', 'success-msg')
                    .html($('<ul/>', { class: 'checked' }).append($('<li/>', { text: localize('Your request to withdraw [_1] [_2] from your account [_3] to Payment Agent [_4] account has been successfully processed.', [request.currency, request.amount, Cookies.get('loginid'), agent_name]) })));
                break;

            default: // error
                if (response.echo_req.dry_run === 1) {
                    setActiveView(view_ids.form);
                    $('#formMessage').setVisibility(1).html(response.error.message);
                } else if (response.error.code === 'InvalidToken') {
                    showPageError(localize('Your token has expired. Please click [_1]here[_2] to restart the verification process.', ['<a href="javascript:;" onclick="window.location.reload();">', '</a>']));
                } else {
                    showPageError(response.error.message);
                }
                break;
        }
    };

    // -----------------------------
    // ----- Message Functions -----
    // -----------------------------
    const showPageError = (err_msg, id) => {
        const $error = $(view_ids.error);
        $error.find(' > p').setVisibility(0);
        if (id) {
            $error.find(`#${id}`).setVisibility(1);
        } else {
            $error.find('#custom-error').html(err_msg).setVisibility(1);
        }
        setActiveView(view_ids.error);
    };

    // ----- View Control -----
    const setActiveView = (view_id) => {
        $views.setVisibility(0);
        $(view_id).setVisibility(1);
    };

    const onLoad = () => {
        BinarySocket.wait('get_account_status').then((data) => {
            $views = $('#paymentagent_withdrawal').find('.viewItem');
            $views.setVisibility(0);

            if (/(withdrawal|cashier)_locked/.test(data.get_account_status.status)) {
                showPageError('', 'withdrawal-locked-error');
            } else {
                BinarySocket.send({ paymentagent_list: Cookies.get('residence') })
                    .then(response => populateAgentsList(response));
            }
        });
    };

    const setAgentName = () => {
        agent_name = $(field_ids.ddl_agents).find('option:selected').text();
        return true;
    };

    return {
        onLoad: onLoad,
    };
})();

module.exports = PaymentAgentWithdraw;
