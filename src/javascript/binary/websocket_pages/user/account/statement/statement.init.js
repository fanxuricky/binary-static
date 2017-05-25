const moment               = require('moment');
const StatementUI          = require('./statement.ui');
const ViewPopup            = require('../../view_extend/view_extend');
const BinarySocket         = require('../../../socket');
const getLanguage          = require('../../../../base/language').get;
const localize             = require('../../../../base/localize').localize;
const showLocalTimeOnHover = require('../../../../base/clock').showLocalTimeOnHover;
const addTooltip           = require('../../../../common_functions/get_app_details').addTooltip;
const buildOauthApps       = require('../../../../common_functions/get_app_details').buildOauthApps;
const dateValueChanged     = require('../../../../common_functions/common_functions').dateValueChanged;
const jpClient             = require('../../../../common_functions/country_base').jpClient;
const toISOFormat          = require('../../../../common_functions/string_util').toISOFormat;
const DatePicker           = require('../../../../components/date_picker');

const StatementInit = (() => {
    'use strict';

    // Batch refer to number of data get from ws service per request
    // chunk refer to number of data populate to ui for each append
    // receive means receive from ws service
    // consume means consume by UI and displayed to page

    let batch_size,
        chunk_size,
        no_more_data,
        pending,
        current_batch,
        transactions_received,
        transactions_consumed;

    const tableExist = () => (document.getElementById('statement-table'));

    const finishedConsumed = () => (transactions_consumed === transactions_received);

    const getStatement = (opts) => {
        const req = { statement: 1, description: 1 };

        if (opts) $.extend(true, req, opts);

        const jump_to_val = $('#jump-to').attr('data-value');
        if (jump_to_val && jump_to_val !== '') {
            req.date_to = moment.utc(jump_to_val).unix() + ((jpClient() ? 15 : 24) * (60 * 60));
            req.date_from = 0;
        }
        BinarySocket.send(req).then((response) => {
            statementHandler(response);
        });
    };

    const getNextBatchStatement = () => {
        getStatement({ offset: transactions_received, limit: batch_size });
        pending = true;
    };

    const getNextChunkStatement = () => {
        const chunk = current_batch.splice(0, chunk_size);
        transactions_consumed += chunk.length;
        $('#rows_count').text(transactions_consumed);
        return chunk;
    };

    const statementHandler = (response) => {
        if (response.error) {
            StatementUI.errorMessage(response.error.message);
            return;
        }

        pending = false;

        const statement = response.statement;
        current_batch = statement.transactions;
        transactions_received += current_batch.length;

        if (current_batch.length < batch_size) {
            no_more_data = true;
        }

        if (!tableExist()) {
            StatementUI.createEmptyStatementTable().appendTo('#statement-container');
            $('.act, .credit').addClass('nowrap');
            $('.act, .credit, .bal, .payout, .date, .ref').addClass('sortable');
            $('.date').click(function() { sortDate(0); });
            $('.ref').click(function() { sortRef(1); });
            $('.payout').click(function() { sortNumber(2); });
            $('.act').click(function() { sortAlphabet(3); });
            $('.credit').click(function() { sortNumber(5); });
            $('.bal').click(function() { sortNumber(6); });
            StatementUI.updateStatementTable(getNextChunkStatement());

            // Show a message when the table is empty
            if (transactions_received === 0 && current_batch.length === 0) {
                $('#statement-table').find('tbody')
                    .append($('<tr/>', { class: 'flex-tr' })
                        .append($('<td/>', { colspan: 7 })
                            .append($('<p/>', { class: 'notice-msg center-text', text: localize('Your account has no trading activity.') }))));
            } else {
                $('#util_row').setVisibility(1);
                if (getLanguage() === 'JA') {
                    $('#download_csv').setVisibility(1)
                                      .find('a')
                                      .unbind('click')
                                      .click(() => { StatementUI.exportCSV(); });
                }
            }
        }
        showLocalTimeOnHover('td.date');
    };

    const loadStatementChunkWhenScroll = () => {
        $(document).scroll(() => {
            const hidableHeight = (percentage) => {
                const total_hideable = $(document).height() - $(window).height();
                return Math.floor((total_hideable * percentage) / 100);
            };

            const p_from_top = $(document).scrollTop();

            if (!tableExist() || p_from_top < hidableHeight(70)) return;

            if (finishedConsumed() && !no_more_data && !pending) {
                getNextBatchStatement();
                return;
            }

            if (!finishedConsumed()) StatementUI.updateStatementTable(getNextChunkStatement());
        });
    };

    const onUnload = () => {
        pending = false;
        no_more_data = false;

        current_batch = [];

        transactions_received = 0;
        transactions_consumed = 0;

        StatementUI.errorMessage(null);
        StatementUI.clearTableContent();
    };

    const initPage = () => {
        batch_size = 200;
        chunk_size = batch_size / 2;
        no_more_data = false;
        pending = false;            // serve as a lock to prevent ws request is sequential
        current_batch = [];
        transactions_received = 0;
        transactions_consumed = 0;

        BinarySocket.send({ oauth_apps: 1 }).then((response) => {
            addTooltip(StatementUI.setOauthApps(buildOauthApps(response)));
            $('.barspinner').setVisibility(0);
        });
        getNextBatchStatement();
        loadStatementChunkWhenScroll();
    };

    const attachDatePicker = () => {
        const jump_to = '#jump-to';
        $(jump_to).attr('data-value', toISOFormat(moment()))
             .change(function() {
                 if (!dateValueChanged(this, 'date')) {
                     return false;
                 }
                 $('.table-container').remove();
                 StatementUI.clearTableContent();
                 initPage();
                 return true;
             });
        DatePicker.init({
            selector: jump_to,
            maxDate : 0,
        });
        if ($(jump_to).attr('data-picker') !== 'native') $(jump_to).val(localize('Today'));
    };

    const liveSearchbox = () => {
        const search_box = '#search-box';
        const noResultbox = '.no-result-box';

        $(search_box).keyup(function() {
            const toSearch = $(this).val();
            let count = 0;
            $(noResultbox).remove();

            // search through each line of table and search for result, i stands for case-insensitive
            $('table tbody tr').each(function() {
                if ($(this).text().search(new RegExp(toSearch.replace(/\\/g, '\\\\'), 'i')) < 0) {
                    $(this).hide();
                } else {
                    $(this).show();
                    count++;
                }
            });

            // show a message if there is no result
            if (count <= 0) {
                $('#statement-table').find('tbody')
                    .append($('<tr/>', { class: 'no-result-box' })
                        .append($('<td/>', { colspan: 7 })
                            .append($('<p/>', { class: 'notice-msg center-text', text: localize('No search result found.') }))));
            }
        });
    };

    const sortNumber = (n) => {
        let dir;
        let switching;
        let rows;
        let shouldSwitch;
        let x;
        let y;
        let i;
        let intx;
        let inty;
        let switchcount = 0;
        const sortTable = document.getElementById('statement-table');
        dir = 'asc';
        switching = true;

        while (switching) {
            switching = false;
            rows = sortTable.getElementsByTagName('TR');
            for (i = 1; i < (rows.length - 1); i++) {
                shouldSwitch = false;
                x = rows[i].getElementsByTagName('TD')[n];
                y = rows[i + 1].getElementsByTagName('TD')[n];

                intx = parseFloat(x.innerText.replace(/,/g, ''));
                inty = parseFloat(y.innerText.replace(/,/g, ''));

                if (isNaN(intx)) {
                    intx = 0;
                } else if (isNaN(inty)) {
                    inty = 0;
                }

                if (dir === 'asc') {
                    if (intx > inty) {
                        shouldSwitch = true;
                        break;
                    }
                } else if (dir === 'desc') {
                    if (intx < inty) {
                        shouldSwitch = true;
                        break;
                    }
                }
            }

            if (shouldSwitch) {
                // move the node 1 step above
                rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
                switching = true;
                switchcount++;
            } else if (switchcount === 0 && dir === 'asc') {
                dir = 'desc';
                switching = true;
            }
        }
    };

    const sortAlphabet = (n) => {
        let dir;
        let switching;
        let rows;
        let shouldSwitch;
        let x;
        let y;
        let i;
        let switchcount = 0;
        const sortTable = document.getElementById('statement-table');
        dir = 'asc';
        switching = true;

        while (switching) {
            switching = false;
            rows = sortTable.getElementsByTagName('TR');
            for (i = 1; i < (rows.length - 1); i++) {
                shouldSwitch = false;
                x = rows[i].getElementsByTagName('TD')[n];
                y = rows[i + 1].getElementsByTagName('TD')[n];
                if (dir === 'asc') {
                    if (x.innerHTML.toLowerCase() > y.innerHTML.toLowerCase()) {
                        shouldSwitch = true;
                        break;
                    }
                } else if (dir === 'desc') {
                    if (x.innerHTML.toLowerCase() < y.innerHTML.toLowerCase()) {
                        shouldSwitch = true;
                        break;
                    }
                }
            }
            if (shouldSwitch) {
                rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
                switching = true;
                switchcount++;
            } else if (switchcount === 0 && dir === 'asc') {
                dir = 'desc';
                switching = true;
            }
        }
    };

    const sortDate = (n) => {
        let dir;
        let switching;
        let rows;
        let shouldSwitch;
        let x;
        let y;
        let i;
        let switchcount = 0;
        const sortTable = document.getElementById('statement-table');
        dir = 'asc';
        switching = true;

        while (switching) {
            switching = false;
            rows = sortTable.getElementsByTagName('TR');
            for (i = 1; i < (rows.length - 1); i++) {
                shouldSwitch = false;
                x = rows[i].getElementsByTagName('TD')[n];
                y = rows[i + 1].getElementsByTagName('TD')[n];

                if (dir === 'asc') {
                    if (x.innerHTML.replace(/[-:GMT \n]/g, '') > y.innerHTML.replace(/[-:GMT \n]/g, '')) {
                        shouldSwitch = true;
                        break;
                    }
                } else if (dir === 'desc') {
                    if (x.innerHTML.replace(/[-:GMT \n]/g, '') < y.innerHTML.replace(/[-:GMT \n]/g, '')) {
                        shouldSwitch = true;
                        break;
                    }
                }
            }
            if (shouldSwitch) {
                rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
                switching = true;
                switchcount++;
            } else if (switchcount === 0 && dir === 'asc') {
                dir = 'desc';
                switching = true;
            }
        }
    };

    const sortRef = (n) => {
        let dir;
        let switching;
        let rows;
        let shouldSwitch;
        let x;
        let y;
        let i;
        let switchcount = 0;
        const sortTable = document.getElementById('statement-table');
        dir = 'asc';
        switching = true;

        while (switching) {
            switching = false;
            rows = sortTable.getElementsByTagName('TR');
            for (i = 1; i < (rows.length - 1); i++) {
                shouldSwitch = false;
                x = rows[i].getElementsByTagName('TD')[n];
                y = rows[i + 1].getElementsByTagName('TD')[n];

                if (dir === 'asc') {
                    if (x.innerText > y.innerText) {
                        shouldSwitch = true;
                        break;
                    }
                } else if (dir === 'desc') {
                    if (x.innerText < y.innerText) {
                        shouldSwitch = true;
                        break;
                    }
                }
            }
            if (shouldSwitch) {
                rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
                switching = true;
                switchcount++;
            } else if (switchcount === 0 && dir === 'asc') {
                dir = 'desc';
                switching = true;
            }
        }
    };

    const onLoad = () => {
        initPage();
        attachDatePicker();
        liveSearchbox();
        ViewPopup.viewButtonOnClick('#statement-container');
    };

    return {
        init            : initPage,
        statementHandler: statementHandler,
        onLoad          : onLoad,
        onUnload        : onUnload,
    };
})();

module.exports = StatementInit;
