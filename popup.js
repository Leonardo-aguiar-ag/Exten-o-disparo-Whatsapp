document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const numeros = $('numeros');
    const contScripts = $('contScripts');
    const selCampanha = $('selCampanha');
    const nomeNovaCampanha = $('nomeNovaCampanha');

    let lastLogCount = -1;
    let isSearching = false;
    let listaCampanhas = {};

    /* ---------- Status WhatsApp ---------- */
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.acao === "wa_status") {
            const bar = $('wa-status-bar'), icon = $('wa-icon'), text = $('wa-text'), chip = $('wa-chip');
            if (msg.info.conectado) {
                bar.className = 'wa-status-bar online';
                icon.innerText = '🟢';
                text.innerText = `Conectado: ${msg.info.nome}`;
                chip.style.display = 'block';
                chip.innerText = `+${msg.info.numero}`;
                $('btnStart').disabled = false;
            } else {
                bar.className = 'wa-status-bar offline';
                icon.innerText = '🔴';
                text.innerText = 'Aguardando WhatsApp...';
                chip.style.display = 'none';
                $('btnStart').disabled = true;
            }
        }
        if (msg.acao === "dispatch_concluido") $('btnStart').disabled = false;
    });

    /* ---------- Carga inicial ---------- */
    chrome.storage.local.get(null, (d) => {
        if (d.theme === 'light') { document.body.classList.add('light-mode'); $('themeToggle').innerText = '☀️'; }
        if (d.numerosSalvos) numeros.value = d.numerosSalvos;

        const cfg = d.config || {};
        $('minDelay').value = cfg.min || 15;
        $('maxDelay').value = cfg.max || 30;
        $('chkPausaLote').checked = cfg.chkPausaLote || false;
        $('qtdLote').value = cfg.qtdLote || 20;
        $('tempoLote').value = cfg.tempoLote || 5;
        $('horarioAtivo').checked = cfg.horarioAtivo || false;
        $('horarioInicio').value = cfg.horarioInicio || '08:00';
        $('horarioFim').value = cfg.horarioFim || '20:00';
        (cfg.diasSemana || [1,2,3,4,5,6]).forEach(dia => {
            const el = document.querySelector(`.diaSemana[value="${dia}"]`);
            if (el) el.checked = true;
        });
        $('ignoraDuplicatas').checked = cfg.ignoraDuplicatas || false;
        $('diasDuplicata').value = cfg.diasDuplicata || 30;
        $('warmUpAtivo').checked = cfg.warmUpAtivo || false;
        $('warmUpInicio').value = cfg.warmUpInicio || '';

        const contas = d.contasDisponiveis || [];
        const sel = $('contaAtual');
        sel.innerHTML = '<option value="">(qualquer aba aberta)</option>';
        contas.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.numero;
            opt.innerText = `+${c.numero} (${c.nome})`;
            sel.appendChild(opt);
        });
        sel.value = cfg.contaAtual || '';

        if (d.filaAtual && (d.filaAtual.status === 'pendente' || d.filaAtual.status === 'rodando' || d.filaAtual.status === 'parado' || d.filaAtual.status === 'pausado_horario')) {
            $('bannerRetomar').classList.add('show');
        }

        listaCampanhas = d.bancoCampanhas || {
            "Campanha Padrão": [
                { texto: "{Olá|Oi|Tudo bem}, [NOME]! Sou o Leonardo Aguiar, consultor Hapvida. Temos condições exclusivas. Me confirme: Idades e Cidade.", ativo: true }
            ]
        };
        atualizarMenuDropdown(d.campanhaSelecionada || "");

        const saved = d.scriptsSalvos || [];
        let html = "";
        for (let i = 0; i < 20; i++) {
            const s = saved[i] || { texto: '', ativo: true };
            html += `<div style="display:flex;gap:10px;margin-bottom:8px;align-items:center;">
                <input type="checkbox" class="chkScript" id="chk_${i}" ${s.ativo ? 'checked' : ''} style="width:18px;height:18px;">
                <textarea class="txtScript" id="txt_${i}" placeholder="Variação ${i+1}" style="flex:1;padding:8px;border-radius:5px;background:var(--input);color:var(--text);border:1px solid var(--border);height:45px;margin:0;font-family:inherit;">${escapeHtml(s.texto)}</textarea>
            </div>`;
        }
        contScripts.innerHTML = html;
        document.querySelectorAll('.chkScript').forEach(chk => chk.addEventListener('change', salvarFilaAtualScripts));

        if (d.abaAtiva) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.aba').forEach(a => a.classList.remove('active'));
            const btn = document.querySelector(`.tab-btn[data-target="${d.abaAtiva}"]`);
            const aba = $(d.abaAtiva);
            if (btn && aba) { btn.classList.add('active'); aba.classList.add('active'); if (d.abaAtiva === 'crm') renderCRM(); }
        }
    });

    function escapeHtml(s) { return !s ? '' : s.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }

    function salvarFilaAtualScripts() {
        const arr = [];
        document.querySelectorAll('.txtScript').forEach((t, i) => {
            const chk = document.getElementById(`chk_${i}`);
            arr.push({ texto: t.value, ativo: chk ? chk.checked : false });
        });
        chrome.storage.local.set({ scriptsSalvos: arr });
        const nome = selCampanha.value;
        if (nome && listaCampanhas[nome]) {
            listaCampanhas[nome] = arr;
            chrome.storage.local.set({ bancoCampanhas: listaCampanhas });
        }
    }

    function salvarConfig() {
        const cfg = {
            min: $('minDelay').value,
            max: $('maxDelay').value,
            chkPausaLote: $('chkPausaLote').checked,
            qtdLote: $('qtdLote').value,
            tempoLote: $('tempoLote').value,
            horarioAtivo: $('horarioAtivo').checked,
            horarioInicio: $('horarioInicio').value,
            horarioFim: $('horarioFim').value,
            diasSemana: Array.from(document.querySelectorAll('.diaSemana:checked')).map(e => parseInt(e.value)),
            ignoraDuplicatas: $('ignoraDuplicatas').checked,
            diasDuplicata: parseInt($('diasDuplicata').value) || 30,
            warmUpAtivo: $('warmUpAtivo').checked,
            warmUpInicio: $('warmUpInicio').value,
            contaAtual: $('contaAtual').value
        };
        chrome.storage.local.get(['config'], d => {
            const merged = Object.assign({}, d.config || {}, cfg);
            chrome.storage.local.set({ config: merged });
        });
    }
    ['minDelay','maxDelay','chkPausaLote','qtdLote','tempoLote','horarioAtivo','horarioInicio','horarioFim','ignoraDuplicatas','diasDuplicata','warmUpAtivo','warmUpInicio','contaAtual'].forEach(id => {
        const el = $(id); if (el) el.addEventListener('change', salvarConfig);
    });
    document.querySelectorAll('.diaSemana').forEach(e => e.addEventListener('change', salvarConfig));

    $('themeToggle').onclick = () => {
        const light = document.body.classList.toggle('light-mode');
        $('themeToggle').innerText = light ? '☀️' : '🌙';
        chrome.storage.local.set({ theme: light ? 'light' : 'dark' });
    };
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.aba').forEach(a => a.classList.remove('active'));
            btn.classList.add('active');
            $(btn.dataset.target).classList.add('active');
            chrome.storage.local.set({ abaAtiva: btn.dataset.target });
            if (btn.dataset.target === 'crm') renderCRM();
        };
    });

    function atualizarMenuDropdown(nome = "") {
        selCampanha.innerHTML = '<option value="">-- Scripts em Edição --</option>';
        Object.keys(listaCampanhas).forEach(n => {
            const opt = document.createElement('option');
            opt.value = n; opt.innerText = n;
            if (n === nome) opt.selected = true;
            selCampanha.appendChild(opt);
        });
        nomeNovaCampanha.value = nome || "";
    }

    selCampanha.addEventListener('change', (e) => {
        const nome = e.target.value;
        chrome.storage.local.set({ campanhaSelecionada: nome });
        if (nome && listaCampanhas[nome]) {
            const dados = listaCampanhas[nome];
            document.querySelectorAll('.txtScript').forEach((t, i) => {
                if (dados[i]) { t.value = dados[i].texto; document.getElementById(`chk_${i}`).checked = dados[i].ativo; }
                else { t.value = ""; document.getElementById(`chk_${i}`).checked = false; }
            });
            nomeNovaCampanha.value = nome;
            salvarFilaAtualScripts();
        } else nomeNovaCampanha.value = "";
    });

    $('btnSalvarCampanha').onclick = () => {
        const nome = nomeNovaCampanha.value.trim();
        if (!nome) return alert("Digite um nome!");
        const arr = [];
        document.querySelectorAll('.txtScript').forEach((t, i) => {
            arr.push({ texto: t.value, ativo: document.getElementById(`chk_${i}`).checked });
        });
        listaCampanhas[nome] = arr;
        chrome.storage.local.set({ bancoCampanhas: listaCampanhas, campanhaSelecionada: nome }, () => {
            atualizarMenuDropdown(nome);
            alert(`Campanha "${nome}" salva!`);
        });
    };

    $('btnDeletarCampanha').onclick = () => {
        const n = selCampanha.value;
        if (!n) return alert("Selecione uma campanha.");
        if (confirm(`Excluir "${n}"?`)) {
            delete listaCampanhas[n];
            chrome.storage.local.set({ bancoCampanhas: listaCampanhas, campanhaSelecionada: "" }, () => atualizarMenuDropdown(""));
        }
    };

    numeros.addEventListener('input', () => chrome.storage.local.set({ numerosSalvos: numeros.value }));
    contScripts.addEventListener('input', salvarFilaAtualScripts);
    contScripts.addEventListener('change', salvarFilaAtualScripts);

    $('btnImportarScripts').onclick = () => $('inputScripts').click();
    $('inputScripts').addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const conteudo = ev.target.result;
            let scripts = [];
            if (file.name.endsWith('.json')) {
                try { const j = JSON.parse(conteudo); scripts = Array.isArray(j) ? j : (j.scripts || []); } catch { alert('JSON inválido'); return; }
            } else scripts = conteudo.split(/\r?\n---\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
            document.querySelectorAll('.txtScript').forEach((t, i) => { t.value = ''; document.getElementById(`chk_${i}`).checked = false; });
            scripts.slice(0, 20).forEach((texto, idx) => {
                document.getElementById(`txt_${idx}`).value = texto;
                document.getElementById(`chk_${idx}`).checked = true;
            });
            const nome = file.name.replace(/\.[^.]+$/, '');
            $('nomeNovaCampanha').value = nome;
            const arr = [];
            document.querySelectorAll('.txtScript').forEach((t, i) => arr.push({ texto: t.value, ativo: document.getElementById(`chk_${i}`).checked }));
            listaCampanhas[nome] = arr;
            chrome.storage.local.set({ bancoCampanhas: listaCampanhas, campanhaSelecionada: nome }, () => atualizarMenuDropdown(nome));
            alert(`Importado: "${nome}"`);
        };
        reader.readAsText(file, 'UTF-8');
        $('inputScripts').value = '';
    });

    $('btnExportarScripts').onclick = () => {
        const scripts = [];
        document.querySelectorAll('.txtScript').forEach((t, i) => {
            const chk = document.getElementById(`chk_${i}`);
            if (chk && chk.checked && t.value.trim()) scripts.push(t.value.trim());
        });
        if (!scripts.length) return alert('Nenhum script ativo.');
        const blob = new Blob([scripts.join('\n---\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'scripts_exportados.txt';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    $('btnLimparScripts').onclick = () => {
        if (confirm('Limpar todos os campos?')) {
            document.querySelectorAll('.txtScript').forEach(t => t.value = '');
            salvarFilaAtualScripts();
        }
    };

    function extrairNumeroNomeLinha(linha) {
        let limpa = linha.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
        if (!limpa) return null;
        let numeroRaw = '', nome = 'Cliente';
        if (limpa.includes(';')) {
            const p = limpa.split(';');
            numeroRaw = p[0].trim();
            if (p[1]) nome = p[1].trim();
        } else if (limpa.includes(':')) {
            const p = limpa.split(':');
            const esq = p[0].trim(), dir = p[1].trim();
            if (/^[\d\+]+$/.test(dir)) { numeroRaw = dir; nome = esq; }
            else if (/^[\d\+]+$/.test(esq)) { numeroRaw = esq; nome = dir; }
            else { const nums = limpa.match(/\d+/g); if (nums) { numeroRaw = nums.join(''); nome = limpa.replace(/\d+/g, '').replace(/[:;]/g, '').trim() || 'Cliente'; } }
        } else if (limpa.includes(' ')) {
            const palavras = limpa.split(/\s+/);
            let cNum = null, cNome = [];
            for (const p of palavras) if (/^[\d\+]+$/.test(p)) cNum = p; else cNome.push(p);
            if (cNum) { numeroRaw = cNum; nome = cNome.join(' ') || 'Cliente'; } else numeroRaw = limpa;
        } else numeroRaw = limpa;
        const so = numeroRaw.replace(/\D/g, '');
        if (!so) return null;
        return { numero: so, nome };
    }

    function formatarNumeroFinal(n) {
        if (n.length < 10) return null;
        if (!n.startsWith('55')) n = '55' + n;
        if (n.length > 13) n = n.slice(0, 13);
        if (n.length < 12) return null;
        const ddd = n.slice(2, 4);
        let resto = n.slice(4);
        if (resto.length === 8) resto = '9' + resto;
        if (resto.length === 9) return '55' + ddd + resto;
        return null;
    }

    function validarLista() {
        const linhas = numeros.value.split(/\r?\n/).filter(l => l.trim());
        const validos = []; let invalidos = 0;
        for (const l of linhas) {
            const ex = extrairNumeroNomeLinha(l);
            if (!ex) { invalidos++; continue; }
            const nf = formatarNumeroFinal(ex.numero);
            if (nf) validos.push({ num: nf, nome: ex.nome }); else invalidos++;
        }
        return { total: linhas.length, validos: validos.length, invalidos, lista: validos };
    }

    function pegarScriptsAtivos() {
        const out = [];
        document.querySelectorAll('.txtScript').forEach((t, i) => {
            const chk = document.getElementById(`chk_${i}`);
            if (chk && chk.checked && t.value.trim()) out.push(t.value.trim());
        });
        return out;
    }

    $('btnPreview').onclick = () => {
        const res = validarLista();
        if (!res.lista.length) return alert('Nenhum número válido!');
        const scripts = pegarScriptsAtivos();
        if (!scripts.length) return alert('Nenhum script ativo!');
        const amostra = res.lista.slice(0, 3);
        let out = "==== PREVIEW ====\n\n";
        amostra.forEach(c => {
            const s = scripts[Math.floor(Math.random() * scripts.length)];
            let texto = s;
            const regex = /{([^{}]*)}/g; let m;
            while ((m = regex.exec(texto)) !== null) {
                const ops = m[1].split('|');
                texto = texto.replace(m[0], ops[Math.floor(Math.random() * ops.length)]);
                regex.lastIndex = 0;
            }
            const nomeF = c.nome.charAt(0).toUpperCase() + c.nome.slice(1).toLowerCase();
            texto = texto.replace(/\[NOME\]/g, nomeF);
            out += `📞 +${c.num} (${c.nome})\n${texto}\n\n`;
        });
        alert(out);
    };

    $('btnStart').onclick = () => {
        const res = validarLista();
        if (!res.lista.length) return alert(`Nenhum número válido (${res.invalidos} inválidos)`);
        const scripts = pegarScriptsAtivos();
        if (!scripts.length) return alert('Nenhum script ativo!');

        const modo = $('modoCampanha').value;
        const agendamento = $('agendamentoData').value ? new Date($('agendamentoData').value).getTime() : null;

        if (!confirm(`Iniciar disparo para ${res.lista.length} contatos?`)) return;

        const min = parseInt($('minDelay').value) || 15;
        const max = parseInt($('maxDelay').value) || 30;
        const estimativa = Math.round(res.lista.length * (((min + max) / 2) + 4));

        $('btnStart').disabled = true;
        chrome.storage.local.set({
            progresso: { total: res.lista.length, enviados: 0 },
            timerData: { inicio: Date.now(), estimativa, totalPausado: 0, ultimoPause: 0, status: 'rodando' }
        }, () => {
            lastLogCount = -1;
            chrome.runtime.sendMessage({
                acao: "iniciar",
                lista: res.lista,
                scripts,
                tipo: modo,
                agendadoPara: agendamento,
                conta: $('contaAtual').value || null
            });
        });
    };

    $('btnPause').onclick = () => chrome.runtime.sendMessage({ acao: "pausar" });
    $('btnStop').onclick = () => {
        chrome.runtime.sendMessage({ acao: "parar" });
        $('btnStart').disabled = false;
    };

    $('btnRetomar').onclick = () => {
        chrome.runtime.sendMessage({ acao: "retomar_fila_pausada" });
        $('bannerRetomar').classList.remove('show');
    };
    $('btnDescartar').onclick = () => {
        if (confirm('Descartar a fila pendente?')) {
            chrome.runtime.sendMessage({ acao: "limpar_fila" });
            $('bannerRetomar').classList.remove('show');
        }
    };

    $('forcarConexao').onclick = () => {
        chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { acao: "ping" });
            else alert("Abra o WhatsApp Web!");
        });
    };

    $('salvarConfig').onclick = () => { salvarConfig(); alert("Salvo!"); };

    $('modoCampanha').addEventListener('change', (e) => {
        $('painelAB').style.display = e.target.value === 'ab' ? 'block' : 'none';
        $('painelDrip').style.display = e.target.value === 'drip' ? 'block' : 'none';
        if (e.target.value === 'ab' && !$('variantesContainer').children.length) addVariante();
        if (e.target.value === 'drip' && !$('passosContainer').children.length) { addPasso(0); addPasso(2); }
    });

    function addVariante() {
        const cont = $('variantesContainer');
        const idx = cont.children.length;
        const div = document.createElement('div');
        div.style = 'margin-bottom:8px;padding:8px;background:var(--bg);border-radius:6px;';
        div.innerHTML = `<label>Variante ${String.fromCharCode(65+idx)}</label><textarea class="varScript" style="height:60px;font-family:inherit;"></textarea>`;
        cont.appendChild(div);
    }
    $('btnAddVariante').onclick = addVariante;

    function addPasso(dia = 0) {
        const cont = $('passosContainer');
        const idx = cont.children.length;
        const div = document.createElement('div');
        div.style = 'margin-bottom:8px;padding:8px;background:var(--bg);border-radius:6px;';
        div.innerHTML = `<label>Passo ${idx} — após <input type="number" class="passoDia" value="${dia}" style="width:60px;display:inline-block;padding:2px;"> dias</label>
            <textarea class="passoScript" style="height:60px;font-family:inherit;" placeholder="Mensagem do passo ${idx}"></textarea>`;
        cont.appendChild(div);
    }
    $('btnAddPasso').onclick = () => addPasso(0);

    $('btnIniciarDrip').onclick = () => {
        const res = validarLista();
        if (!res.lista.length) return alert('Lista vazia!');
        const passos = [];
        Array.from($('passosContainer').children).forEach((el, i) => {
            const dia = parseInt(el.querySelector('.passoDia').value) || 0;
            const script = el.querySelector('.passoScript').value.trim();
            if (script) passos.push({ dia, scripts: [script] });
        });
        if (!passos.length) return alert('Adicione pelo menos 1 passo!');
        const min = parseInt($('minDelay').value) || 15;
        const max = parseInt($('maxDelay').value) || 30;
        chrome.runtime.sendMessage({
            acao: "iniciar_drip",
            contatos: res.lista,
            passos,
            conta: $('contaAtual').value || null,
            config: {
                min, max,
                pausaLoteAtiva: $('chkPausaLote').checked,
                qtdLote: parseInt($('qtdLote').value) || 20,
                tempoLoteMin: parseInt($('tempoLote').value) || 5
            }
        });
        alert('Sequência criada! Passo 0 vai iniciar.');
    };

    function formatarTempo(s) {
        if (!s || isNaN(s) || s < 0) return "00:00:00";
        const h = Math.floor(s/3600).toString().padStart(2,'0');
        const m = Math.floor((s%3600)/60).toString().padStart(2,'0');
        const sec = Math.floor(s%60).toString().padStart(2,'0');
        return `${h}:${m}:${sec}`;
    }

    function renderCRM(logsData = null) {
        chrome.storage.local.get({ logs: [], respostas: {} }, d => {
            const data = logsData || d.logs;
            $('crmTotal').innerText = data.length;
            $('crmOk').innerText = data.filter(l => l.status === 'OK').length;
            $('crmErro').innerText = data.filter(l => l.status !== 'OK' && l.status !== 'DUPLICADO').length;
            $('crmResp').innerText = Object.keys(d.respostas || {}).length;
            desenharTabela(data);
        });
    }

    function desenharTabela(logs) {
        $('crmBody').innerHTML = logs.slice(-200).map((l, i) => {
            const corStatus = l.status === 'OK' ? '#10b981' : l.status === 'DUPLICADO' ? '#f59e0b' : '#ef4444';
            return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px;color:var(--sub);">${i+1}</td>
                <td style="padding:6px;">${escapeHtml(l.nome) || 'Cliente'}</td>
                <td style="padding:6px;">${l.numero}</td>
                <td style="padding:6px;color:${corStatus};font-weight:600;">${l.status}</td>
                <td style="padding:6px;">${l.variante || '-'}</td>
                <td style="padding:6px;color:var(--sub);font-family:monospace;">${l.hora || '-'}</td>
            </tr>`;
        }).join('');
    }

    $('crmBusca').addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase().trim();
        isSearching = termo !== '';
        chrome.storage.local.get({ logs: [] }, d => {
            const f = d.logs.filter(l => l.numero.includes(termo) || (l.nome && l.nome.toLowerCase().includes(termo)));
            desenharTabela(f);
        });
    });

    $('btnExportar').onclick = () => {
        chrome.storage.local.get({ logs: [] }, d => {
            if (!d.logs.length) return alert('Nada para exportar.');
            const ws = XLSX.utils.json_to_sheet(d.logs);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
            XLSX.writeFile(wb, "Relatorio_Disparos.xlsx");
        });
    };

    $('btnBackup').onclick = () => {
        chrome.runtime.sendMessage({ acao: "backup_dados" }, (res) => {
            if (!res || !res.ok) return alert('Erro no backup');
            const blob = new Blob([JSON.stringify(res.dados, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = `private_bot_backup_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    };

    $('btnRestaurar').onclick = () => $('inputRestore').click();
    $('inputRestore').addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const dados = JSON.parse(ev.target.result);
                if (!confirm('Substituir TODOS os dados atuais pelo backup?')) return;
                chrome.runtime.sendMessage({ acao: "restaurar_dados", dados }, () => {
                    alert('Restaurado! Recarregue o popup.');
                    location.reload();
                });
            } catch { alert('Arquivo inválido.'); }
        };
        reader.readAsText(file);
        $('inputRestore').value = '';
    });

    $('btnLimparCRM').onclick = () => {
        if (confirm('Apagar TODOS os logs, respostas e duplicatas?')) {
            chrome.runtime.sendMessage({ acao: "zerar_crm" }, () => renderCRM());
        }
    };

    setInterval(() => {
        chrome.storage.local.get(['progresso', 'timerData', 'logs'], d => {
            if (d.progresso && d.progresso.total > 0) {
                const p = Math.round((d.progresso.enviados / d.progresso.total) * 100);
                $('bar').style.width = p + "%";
                $('percent').innerText = p + "%";
                $('txtEnvios').innerText = `${d.progresso.enviados} / ${d.progresso.total} enviados`;

                if (p === 100) $('statusCampanha').innerText = "✅ CAMPANHA CONCLUÍDA!";
                else if (d.timerData && d.timerData.status === 'pausado') $('statusCampanha').innerText = "⏸ DISPARO PAUSADO";
                else if (d.timerData && d.timerData.status === 'parado') $('statusCampanha').innerText = "⏹ DISPARO PARADO";
                else $('statusCampanha').innerText = `Enviando ${Math.min(d.progresso.enviados+1, d.progresso.total)} de ${d.progresso.total}...`;
            }
            if (d.timerData) {
                $('valEstimado').innerText = formatarTempo(d.timerData.estimativa);
                let dec = 0;
                if (d.timerData.status === 'rodando') dec = Math.floor((Date.now() - d.timerData.inicio - d.timerData.totalPausado) / 1000);
                else { const fim = d.timerData.ultimoPause || Date.now(); dec = Math.floor((fim - d.timerData.inicio - d.timerData.totalPausado) / 1000); }
                if (dec >= 0) $('valDecorrido').innerText = formatarTempo(dec);
            }
            if (d.logs && d.logs.length !== lastLogCount && !isSearching) {
                lastLogCount = d.logs.length;
                if ($('crm').classList.contains('active')) renderCRM(d.logs);
            }
        });
    }, 1000);
});