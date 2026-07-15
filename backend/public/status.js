async function refresh() {
    try {
        const response = await fetch('/stats.json', { cache: 'no-store' });
        const stats = await response.json();
        document.getElementById('backend-name').textContent = stats.name || 'Backend de latencia';
        document.getElementById('tests').textContent = stats.tests.toLocaleString('es-ES');
        document.getElementById('connections').textContent = stats.websocketConnections.toLocaleString('es-ES');
        document.getElementById('active').textContent = stats.activeConnections.toLocaleString('es-ES');
        document.getElementById('bytes').textContent = stats.bytesEchoed.toLocaleString('es-ES');
        document.getElementById('last').textContent = stats.lastTestAt ? new Date(stats.lastTestAt).toLocaleString('es-ES') : 'Todavía ninguno';
    } catch (error) {
        console.warn('No se pudieron actualizar las estadísticas', error);
    }
}
refresh();
setInterval(refresh, 2000);
