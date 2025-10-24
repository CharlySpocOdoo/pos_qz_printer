/** @odoo-module **/
/**
 * @typedef {import("@web/core/orm_service").ORM} ORM
 */

import { OrderReceipt } from "@point_of_sale/app/screens/receipt_screen/receipt/order_receipt";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";

var qzVersion = 0;
var data_to_print = ''
var company_id = null;
var printer_name = null;

    function findVersion() {
        qz.api.getVersion().then(function(data) {
            qzVersion = data;
        });
    }

    function startConnection(config) {
        qz.security.setCertificatePromise(function(resolve, reject) {
            $.ajax("/pos_qz_printer/static/src/lib/digital-certificate.txt").then(resolve, reject);
        });

        function strip(key) {
            if (key.indexOf('-----') !== -1) {
                return key.split('-----')[2].replace(/\r?\n|\r/g, '');
            }
        }

        if (!qz.websocket.isActive()) {
            console.log('Waiting default');
            qz.websocket.connect(config).then(function() {
                console.log('Active success');
                findVersion();
                findPrinters();
            });
        } else {
            console.log('An active connection with QZ already exists.', 'alert-warning');
        }
    }

    function findPrinters() {
        setPrinter(printer_name);
    }

    function setPrinter(printer) {
        var cf = getUpdatedConfig();
        cf.setPrinter(printer);
        if (typeof printer === 'object' && printer.name == undefined) {
            var shown;
            if (printer.file != undefined) {
                shown = "<em>FILE:</em> " + printer.file;
            }
            if (printer.host != undefined) {
                shown = "<em>HOST:</em> " + printer.host + ":" + printer.port;
            }
        } else {
            if (printer.name != undefined) {
                printer = printer.name;
            }

            if (printer == undefined) {
                printer = 'NONE';
            }
            printReceipt();
        }
    }
    /// QZ Config ///
    var cfg = null;

    function getUpdatedConfig() {
        if (cfg == null) {
            cfg = qz.configs.create(null);
        }

        cfg.reconfigure({
            copies: 1,
            margins: {top: 0, left: 0.75},

        });
        return cfg
    }
    function printReceipt() {
        var config = getUpdatedConfig();
            var printData =
            [
                data_to_print
           ];
            qz.print(config, printData).catch(function(e) { console.error(e); });
        location.reload();
    }

patch(PosStore.prototype, {
    async printReceipt(order = this.get_order()) {
        const el = await this.printer.renderer.toHtml(OrderReceipt, {
                data: this.orderExportForPrinting(order),
                formatCurrency: this.env.utils.formatCurrency,
            })
        data_to_print = el.outerText
        company_id = order.company_id.id;
        const response = await this.data.call('res.company', 'read', [company_id]);
        if (response){
            printer_name = response[0].pos_printer
            startConnection()
        }
        else{
            await this.printer.print(
                OrderReceipt,
                {
                    data: this.orderExportForPrinting(order),
                    formatCurrency: this.env.utils.formatCurrency,
                },
                { webPrintFallback: true }
            );
            const nbrPrint = order.nb_print;
            await this.data.write("pos.order", [order.id], { nb_print: nbrPrint + 1 });
            return true;
        }
    }
});