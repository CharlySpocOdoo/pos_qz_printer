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
        });

        // ======================
        // FORMATO ESC/POS
        // ======================
        const ESC = '\x1B';
        const GS  = '\x1D';
        const data = [];

        // Inicializar impresora
        data.push(ESC + '@');

        // LOGO (si está almacenado en la impresora como NV logo #1)
        data.push(ESC + 'a' + '\x01'); // Centrado
        data.push('\x1C\x70\x01\x00'); // Imprimir logo #1

        // Encabezado
        data.push(ESC + '!' + '\x30'); // Doble alto/ancho
        data.push('ROSA DE LIMA\n');
        data.push(ESC + '!' + '\x00'); // Texto normal
        data.push('--------------------------------\n');

        // Datos del ticket
        const cashier = order.get_cashier()?.name || '-';
        const date = luxon.DateTime.now().toFormat('dd/MM/yyyy HH:mm');
        data.push(`Ticket: ${order.name}\n`);
        data.push(`Cajero: ${cashier}\n`);
        data.push(`Fecha: ${date}\n`);
        data.push('--------------------------------\n');

        // Productos
        order.get_orderlines().forEach(line => {
            const ref = line.defaultCode ? `${line.defaultCode}\n` : '';
            const name = line.product_name.slice(0, 30);
            const price = line.get_display_price().toFixed(2);
            data.push(ref); // Referencia interna arriba
            data.push(`${name}\n`);
            data.push(`   $${price}\n`);
        });

        // Totales
        data.push('--------------------------------\n');
        data.push(ESC + 'E' + '\x01'); // Negrita ON
        data.push('TOTAL:           $' + order.get_total_with_tax().toFixed(2) + '\n');
        data.push(ESC + 'E' + '\x00'); // Negrita OFF
        data.push('--------------------------------\n');

        // Mensaje final
        data.push(ESC + 'a' + '\x01'); // Centrado
        data.push('¡Gracias por su compra!\n');
        data.push('--------------------------------\n');

        // Corte de papel
        data.push('\n\n');
        data.push(GS + 'V' + '\x41'); // Corte parcial

        // Configuración e impresión
        const config = qz.configs.create(null);
        config.reconfigure({ copies: 1, margins: { top: 0, left: 0 } });

        await qz.print(config, data)
            .then(() => console.log('✅ Ticket impreso correctamente'))
            .catch(e => console.error('❌ Error al imprimir:', e));

        location.reload();
    }
});
