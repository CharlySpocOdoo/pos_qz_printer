/** @odoo-module **/
/**
 * Modificado para Epson TM-T20II con formato ESC/POS profesional
 * Mantiene la lógica original del módulo de Kanak (conexión y printer_name)
 */

import { OrderReceipt } from "@point_of_sale/app/screens/receipt_screen/receipt/order_receipt";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";

let qzVersion = 0;
let data_to_print = "";
let company_id = null;
let printer_name = null;

function findVersion() {
    qz.api.getVersion().then(function (data) {
        qzVersion = data;
    });
}

function startConnection(config) {
    qz.security.setCertificatePromise(function (resolve, reject) {
        $.ajax("/pos_qz_printer/static/src/lib/digital-certificate.txt").then(resolve, reject);
    });

    if (!qz.websocket.isActive()) {
        qz.websocket.connect(config).then(function () {
            findVersion();
            findPrinters();
        });
    } else {
        console.log("QZ Tray ya está activo.");
    }
}

function findPrinters() {
    setPrinter(printer_name);
}

function setPrinter(printer) {
    const cf = getUpdatedConfig();
    cf.setPrinter(printer);
    if (typeof printer === "object" && printer.name == undefined) {
        if (printer.file != undefined) {
            console.log("Archivo destino:", printer.file);
        }
        if (printer.host != undefined) {
            console.log("Host destino:", printer.host + ":" + printer.port);
        }
    } else {
        if (printer.name != undefined) {
            printer = printer.name;
        }
        if (printer == undefined) {
            printer = "NONE";
        }
        printReceipt();
    }
}

/// QZ Config ///
let cfg = null;
function getUpdatedConfig() {
    if (cfg == null) {
        cfg = qz.configs.create(null);
    }
    cfg.reconfigure({
        copies: 1,
        margins: { top: 0, left: 0 },
    });
    return cfg;
}

/**
 * Imprime el ticket con formato ESC/POS
 */
function printReceipt() {
    const config = qz.configs.create(printer_name || "EPSON TM-T20II Receipt", {
        encoding: "850",
    });

    const ESC = "\x1B";
    const GS = "\x1D";
    const data = [];

    // 🔸 Inicializar
    data.push(ESC + "@");

    // 🔸 Logo centrado (si está grabado en la impresora)
    data.push(ESC + "a" + "\x01");
    data.push("\x1C\x70\x01\x00"); // Logo #1

    // 🔸 Encabezado
    data.push(ESC + "!" + "\x30"); // Doble ancho y alto
    data.push("ROSA DE LIMA\n");
    data.push(ESC + "!" + "\x00");
    data.push("================================\n");

    // 🔸 Datos del ticket (extraídos del texto de data_to_print)
    const lines = data_to_print.split("\n").filter((l) => l.trim() !== "");
    let foundHeader = false;
    let orderInfo = [];
    let productLines = [];
    let totalLine = "";

    for (const l of lines) {
        if (!foundHeader) {
            if (l.toLowerCase().includes("order") || l.toLowerCase().includes("ticket")) {
                foundHeader = true;
            }
            orderInfo.push(l);
        } else if (l.toLowerCase().includes("total")) {
            totalLine = l;
        } else {
            productLines.push(l);
        }
    }

    // 🔸 Información del pedido
    data.push(ESC + "E" + "\x01");
    data.push(orderInfo.join("\n") + "\n");
    data.push(ESC + "E" + "\x00");
    data.push("--------------------------------\n");

    // 🔸 Productos (con posible referencia)
    productLines.forEach((p) => {
        const clean = p.replace(/\s\s+/g, " ");
        data.push(clean + "\n");
    });

    data.push("--------------------------------\n");

    // 🔸 Totales
    if (totalLine) {
        data.push(ESC + "E" + "\x01"); // Negrita
        data.push(totalLine + "\n");
        data.push(ESC + "E" + "\x00");
    }

    // 🔸 Mensaje final
    data.push("--------------------------------\n");
    data.push(ESC + "a" + "\x01");
    data.push("¡Gracias por su compra!\n");
    data.push(ESC + "a" + "\x00");

    // 🔸 Corte
    data.push("\n\n");
    data.push(GS + "V" + "\x41");

    // 🔸 Enviar a QZ
    qz.print(config, data)
        .then(() => console.log("✅ Ticket enviado a QZ Tray"))
        .catch((e) => console.error("❌ Error al imprimir:", e));
}

/**
 * Reemplazo principal de la función original
 */
patch(PosStore.prototype, {
    async printReceipt(order = this.get_order()) {
        // 🔹 Generar HTML base del ticket (sin formato visual)
        const el = await this.printer.renderer.toHtml(OrderReceipt, {
            data: this.orderExportForPrinting(order),
            formatCurrency: this.env.utils.formatCurrency,
        });

        // Guardar texto plano para procesar dentro de printReceipt()
        data_to_print = el.outerText;
        company_id = order.company_id.id;

        // Leer la impresora desde la compañía
        const response = await this.data.call("res.company", "read", [company_id]);
        if (response) {
            printer_name = response[0].pos_printer;
            startConnection();
        } else {
            // Fallback a impresión web estándar
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
    },
});
