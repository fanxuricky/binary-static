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
        transactions_consumed,
        sorted,
        sort_direction = null,
        current_sort = [];

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
            $('.date').click(function() { sortAnything([0, 'date', '.date']); });
            $('.ref').click(function() { sortAnything([1, 'number', '.ref']); });
            $('.payout').click(function() { sortAnything([2, 'number', '.payout']); });
            $('.act').click(function() { sortAnything([3, 'alphabet', '.act']); });
            $('.credit').click(function() { sortAnything([5, 'number', '.credit']); });
            $('.bal').click(function() { sortAnything([6, 'number', '.bal']); });
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

            if (!finishedConsumed()) {
                StatementUI.updateStatementTable(getNextChunkStatement());
                if (sorted) {
                    sort_direction = null;
                    sortAnything(current_sort);
                }
                liveSearchbox(true);
            }
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
        if ($(jump_to).attr('data-picker') !== 'native') { $(jump_to).val(localize('Today')); }
    };

    const liveSearchbox = (nextChunk) => {
        const search_box = '#search-box';
        const noResultbox = '.no-result-box';

        const searchThru = (toSearch) => {
            let count = 0;
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
            if (!no_more_data || !finishedConsumed()) {
                $('#statement-table').find('tbody')
                    .append($('<tr/>', { class: 'no-result-box' })
                        .append($('<td/>', { colspan: 7 })
                            .append($('<p/>', { class: 'notice-msg center-text', text: localize('Scroll down to search more.') }))));
            } else if (count <= 0) {
                $('#statement-table').find('tbody')
                    .append($('<tr/>', { class: 'no-result-box' })
                        .append($('<td/>', { colspan: 7 })
                            .append($('<p/>', { class: 'notice-msg center-text', text: localize('No search result found.') }))));
            }
        };

        if (nextChunk === true) {
            const toSearch = $(search_box).val();
            $(noResultbox).remove();
            searchThru(toSearch);
        } else {
            $(search_box).keyup(function() {
                const toSearch = $(this).val();
                $(noResultbox).remove();
                searchThru(toSearch);
            });
        }
    };

    const sortAnything = (typeArray) => { // n(number of column), sortType, m(header)
        let i,
            j;
        const sortTable = tableExist();
        const rows = sortTable.getElementsByTagName('TR');
        if (typeArray[2] !== current_sort[2]) {
            $('.ascending').removeClass('ascending');
            $('.descending').removeClass('descending');
            current_sort = typeArray;
            sort_direction = null;
        }
        sorted = true;

        function replaceRegex(x) {
            if (typeArray[1] === 'number') {
                x = parseFloat(x.innerText.replace(/[.,]/g, ''));
                if (isNaN(x)) {
                    x = 0;
                }
            } else if (typeArray[1] === 'alphabet') {
                x = x.innerHTML.toLowerCase();
            } else if (typeArray[1] === 'date') {
                x = x.innerHTML.replace(/[-:GMT \n]/g, '');
            }
            return x;
        }

        function sorting(arr, left, right) {
            let pivot,
                pindex;
            if (left < right) {
                pivot = right;

                pindex = partition(arr, pivot, left, right);
                sorting(arr, left, pindex - 1);
                sorting(arr, pindex + 1, right);
            }
            return arr;
        }

        function partition(arr, pivot, left, right) {
            const pivotValue = replaceRegex(arr[pivot].children[typeArray[0]]);
            let pindex = left;
            for (i = left; i < right; i++) {
                if (replaceRegex(arr[i].children[typeArray[0]]) < pivotValue) {
                    swap(arr, i, pindex);
                    pindex++;
                }
            }
            swap(arr, right, pindex);
            return pindex;
        }

        function swap(arr, x, y) {
            const temp = arr[x].outerHTML;
            arr[x].outerHTML = arr[y].outerHTML;
            arr[y].outerHTML = temp;
        }

        function reverseRow() {
            for (j = 1; j < rows.length / 2; j++) {
                const temp = rows[j].outerHTML;
                rows[j].outerHTML = rows[rows.length - j].outerHTML;
                rows[rows.length - j].outerHTML = temp;
            }
        }

        if (sort_direction === null) {
            $(typeArray[2]).addClass('ascending');
            sorting(rows, 1, (rows.length - 1));
            sort_direction = 'ascending';
        } else if (sort_direction === 'ascending') {
            $(typeArray[2]).removeClass('ascending');
            $(typeArray[2]).addClass('descending');
            reverseRow();
            sort_direction = 'descending';
        } else if (sort_direction === 'descending') {
            $(typeArray[2]).removeClass('descending');
            $(typeArray[2]).addClass('ascending');
            reverseRow();
            sort_direction = 'ascending';
        }
    };

    const onLoad = () => {
        initPage();
        attachDatePicker();
        liveSearchbox(false);
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
