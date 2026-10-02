:root {
    font-family: Inter,Segoe UI,system-ui,sans-serif;
    color: #172033;
    background: #edf0f4;
    --ink: #172033;
    --muted: #697386;
    --line: #dce2eb;
    --brand: #176b61;
    --nav: #172033
}

* {
    box-sizing: border-box
}

body {
    margin: 0
}

button,input,select {
    font: inherit
}

.prototype-bar {
    height: 32px;
    padding: 0 16px;
    background: #fff4cf;
    color: #5b4704;
    border-bottom: 1px solid #ead891;
    display: flex;
    gap: 18px;
    align-items: center;
    font-size: 12px
}

.prototype-bar span:nth-child(2) {
    margin-left: auto
}

.text-button {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 6px;
    text-decoration: underline
}

.entry-view {
    min-height: calc(100vh - 32px);
    display: grid;
    place-items: center;
    padding: 28px;
    background: radial-gradient(circle at 14% 20%,#d9f2ea,transparent 28%),radial-gradient(circle at 85% 75%,#e8e1ff,transparent 30%),#f7f8fa
}

.entry-card {
    width: min(520px,100%);
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 34px;
    box-shadow: 0 24px 70px #26334b1c
}

.mark {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: var(--brand);
    color: #fff;
    display: grid;
    place-items: center;
    font-weight: 800
}

.mark.small {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    font-size: 11px
}

.eyebrow {
    font-size: 11px;
    letter-spacing: .13em;
    font-weight: 750;
    color: var(--muted);
    margin: 14px 0 5px
}

h1 {
    font-size: 30px;
    margin: 0
}

.subtle {
    color: var(--muted);
    margin: 8px 0 22px
}

.mode-list {
    display: grid;
    gap: 10px
}

.mode {
    position: relative;
    text-align: left;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: #fff;
    padding: 15px 42px 15px 15px;
    cursor: pointer
}

.mode:hover,.mode.featured {
    border-color: #8acabe;
    background: #f0faf7
}

.mode b,.mode span {
    display: block
}

.mode span {
    font-size: 13px;
    color: var(--muted);
    margin-top: 3px
}

.mode i {
    position: absolute;
    right: 15px;
    top: 24px;
    font-size: 22px;
    font-style: normal;
    color: var(--brand)
}

label {
    display: grid;
    gap: 7px;
    color: #596276;
    font-size: 13px;
    font-weight: 650;
    margin: 15px 0
}

input,select {
    padding: 10px 11px;
    border: 1px solid #cbd3df;
    border-radius: 9px;
    background: #fff;
    color: var(--ink);
    outline: none
}

input:focus,select:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px #2d8a7d24
}

.primary,.secondary,.icon {
    border-radius: 9px;
    padding: 9px 13px;
    font-weight: 700;
    cursor: pointer
}

.primary {
    border: 1px solid var(--brand);
    background: var(--brand);
    color: #fff
}

.secondary,.icon {
    border: 1px solid #cbd3df;
    background: #fff;
    color: var(--ink)
}

.wide {
    width: 100%;
    margin-top: 8px
}

.steps {
    display: flex;
    gap: 6px;
    margin: 4px 0 18px
}

.steps i {
    height: 4px;
    flex: 1;
    border-radius: 5px;
    background: #e1e6ed
}

.steps .on {
    background: var(--brand)
}

.wizard-actions {
    display: flex;
    justify-content: space-between;
    margin-top: 18px
}

.app {
    height: calc(100vh - 32px);
    display: grid;
    grid-template-columns: 220px 1fr;
    grid-template-rows: 1fr 31px
}

.sidebar {
    grid-row: 1/3;
    background: var(--nav);
    color: #dfe7f2;
    padding: 16px 11px;
    display: flex;
    flex-direction: column
}

.brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 9px 18px
}

.nav {
    border: 0;
    background: transparent;
    color: #b8c2d1;
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 9px 11px;
    border-radius: 8px;
    text-align: left;
    cursor: pointer
}

.nav b {
    margin-left: auto;
    font-size: 11px
}

.nav.active,.nav:hover {
    background: #2a3547;
    color: #fff
}

.nav-label {
    font-size: 10px;
    letter-spacing: .12em;
    color: #78869a;
    margin: 23px 11px 7px
}

.nav-label button {
    float: right;
    border: 0;
    background: none;
    color: #9caac0
}

.sidebar-bottom {
    margin-top: auto
}

.workspace {
    min-width: 0;
    display: grid;
    grid-template-rows: 56px 1fr;
    overflow: hidden;
    background: #172033;
}

.topbar {
    padding: 0 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #172033
}

.command-trigger {
    width: min(560px,65%);
    border: 1px solid #405067;
    background: #263346;
    color: #bfcada;
    border-radius: 8px;
    padding: 8px 11px;
    text-align: left;
    display: flex;
    gap: 9px;
    align-items: center;
    cursor: pointer
}

.command-trigger kbd {
    margin-left: auto;
    font-size: 11px;
    color: #91a0b4
}

.top-actions {
    display: flex;
    gap: 8px
}

.icon {
    padding: 7px 9px;
    background: #263346;
    color: #dce5ef;
    border-color: #405067
}

.command-menu {
    position: fixed;
    z-index: 5;
    top: 76px;
    left: max(240px,calc(50% - 300px));
    width: min(600px,calc(100vw - 30px));
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px;
    box-shadow: 0 20px 60px #17203340
}

.command-menu input {
    width: 100%;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 12px
}

.command-menu p {
    font-size: 10px;
    letter-spacing: .1em;
    color: var(--muted);
    margin: 14px 9px 6px
}

.command-menu button {
    width: 100%;
    border: 0;
    background: #fff;
    border-radius: 8px;
    padding: 9px;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px
}

.command-menu button:hover {
    background: #f0f6f5
}

.command-menu small,.command-menu b {
    display: block
}

.columns {
    display: grid;
    grid-template-columns: minmax(310px,35%) 1fr;
    min-height: 0;
    gap: 14px;
    /* padding:14px; */
}

.item-column,.detail-column {
    background: #fff;
    border: 1px solid #e2e6ed;
    border-radius: 15px;
    box-shadow: 0 8px 28px #24334b0a
}

.item-column {
    padding: 16px;
    overflow: auto
}

.list-heading {
    display: flex;
    justify-content: space-between;
    align-items: start
}

.list-heading h1 {
    font-size: 22px
}

.list-heading span {
    font-size: 12px;
    color: var(--muted)
}

.list-heading select {
    padding: 7px;
    font-size: 12px
}

.item-list {
    display: grid;
    gap: 7px;
    margin-top: 16px
}

.item-list.grid {
    grid-template-columns: repeat(auto-fit,minmax(150px,1fr));
    gap: 9px
}

.item-row {
    display: grid;
    grid-template-columns: 36px 1fr auto;
    align-items: center;
    gap: 10px;
    border: 1px solid transparent;
    background: #fff;
    padding: 9px;
    border-radius: 11px;
    text-align: left;
    cursor: pointer
}

.item-row:hover {
    background: #f7faf9
}

.item-row.active {
    border-color: #b7ddd5;
    background: #f5fbf9
}

.grid .item-row {
    grid-template-columns: 36px 1fr
}

.grid .item-row em {
    grid-column: 2
}

.dense .item-row {
    padding: 6px
}

.dense .site-icon {
    width: 30px;
    height: 30px;
    font-size: 11px
}

.site-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: #e8ecf3;
    font-weight: 800;
    color: #435066
}

.item-row b,.item-row small {
    display: block
}

.item-row small,.item-row em {
    color: var(--muted);
    font-size: 12px;
    font-style: normal
}

.detail-column {
    padding: 28px clamp(22px,4vw,60px);
    overflow: auto
}

.detail-head {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: flex-start
}

.title-row {
    display: flex;
    gap: 13px
}

.detail-head .site-icon {
    width: 48px;
    height: 48px;
    font-size: 17px
}

.detail-head h2 {
    font-size: 27px;
    margin: 0 0 3px
}

.detail-head a {
    display: block;
    color: var(--brand);
    font-size: 14px;
    margin-top: 5px
}

.vault-link {
    display: block;
    border: 0;
    background: none;
    padding: 0;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    text-align: left
}

.vault-link:hover {
    color: var(--brand);
    text-decoration: underline
}

section {
    /* margin-top:28px; */
}

.section-head {
    display: flex;
    justify-content: space-between;
    align-items: center
}

.section-head h3,section h3 {
    font-size: 13px;
    margin: 0 0 9px
}

.field-card {
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden
}

.field {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 15px
}

.field+.field {
    border-top: 1px solid var(--line)
}

.field>span {
    width: 82px;
    color: var(--muted);
    font-size: 12px
}

.field>strong {
    flex: 1
}

.copy {
    border: 0;
    background: none;
    color: var(--brand);
    font-weight: 700;
    cursor: pointer
}

.mono {
    font-family: ui-monospace,SFMono-Regular,Consolas,monospace
}

.add-field {
    width: 100%;
    border: 1px dashed #b9c4d2;
    border-radius: 10px;
    background: #fafbfc;
    color: var(--brand);
    padding: 12px;
    text-align: left;
    font-weight: 700;
    cursor: pointer
}

.meta {
    color: var(--muted);
    font-size: 12px;
    margin-top: 28px
}

.password-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px
}

.form-actions {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-top: 25px
}

.form-actions span {
    font-size: 12px;
    color: var(--muted)
}

.status {
    grid-column: 2;
    background: #172033;
    color: #aebccd;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    font-size: 11px
}

.status i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #42c2ad
}

.status b {
    color: #dbe5ef
}

.status .text-button {
    margin-left: auto;
    color: #b5dcd5
}

.toast {
    position: fixed;
    right: 24px;
    bottom: 42px;
    background: #172033;
    color: #fff;
    padding: 12px 16px;
    border-radius: 10px;
    opacity: 0;
    transform: translateY(10px);
    transition: .2s
}

.toast.show {
    opacity: 1;
    transform: none
}

@media(max-width: 800px) {
    .app {
        grid-template-columns:66px 1fr
    }

    .sidebar {
        padding: 14px 8px
    }

    .brand b,.nav {
        font-size: 0
    }

    .nav b {
        display: none
    }

    .nav-label {
        display: none
    }

    .columns {
        grid-template-columns: 1fr
    }

    .detail-column {
        position: fixed;
        z-index: 4;
        left: 0;
        right: 0;
        bottom: 0;
        max-height: 84vh;
        border-radius: 20px 20px 0 0;
        padding: 24px;
        box-shadow: 0 -12px 45px #17203332;
        animation: sheet .25s ease-out
    }

    .detail-column:before {
        content: "";
        display: block;
        width: 36px;
        height: 4px;
        border-radius: 4px;
        background: #d5dbe4;
        margin: 0 auto 18px
    }

    @keyframes sheet {
        from {
            transform: translateY(100%)
        }

        to {
            transform: none
        }
    }

    .command-menu {
        left: 15px;
        top: 48px
    }
}

@media(max-width: 520px) {
    .app {
        grid-template-columns:1fr
    }

    .sidebar {
        display: none
    }

    .status {
        grid-column: 1
    }

    .topbar {
        padding: 0 10px
    }

    .top-actions .icon {
        display: none
    }

    .command-trigger {
        width: calc(100% - 102px);
        font-size: 12px
    }

    .command-trigger kbd,.prototype-bar span:nth-child(2) {
        display: none
    }

    .columns {
        padding: 9px
    }

    .item-column {
        padding: 14px
    }

    .entry-card {
        padding: 27px 22px
    }

    .field {
        gap: 10px;
        padding: 13px
    }

    .field>span {
        width: 68px
    }

    .password-row {
        grid-template-columns: 1fr auto
    }

    .password-row .secondary:last-child {
        grid-column: 2
    }
}
