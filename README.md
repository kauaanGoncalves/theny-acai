# Theny Açaí — catálogo e pedidos

Catálogo responsivo e instalável para o cliente montar um pedido no celular e para a vendedora organizar o estoque e os pedidos.

## Como usar

Abra `index.html` em um navegador. O cliente informa o nome, escolhe um produto, marca os complementos e caldas e envia. A vendedora abre **Painel da vendedora** no topo para riscar itens em falta, cadastrar produtos, complementos e caldas, marcar pedidos como realizados, reabri-los ou excluí-los.

As opções e limites seguem a ficha de referência: Potinho permite até 3 complementos e 2 caldas; Copinho permite 1 complemento e 1 calda, além de escolher entre Açaí e Creme.

## Publicar online

Os arquivos são estáticos e podem ser publicados em um serviço de hospedagem estática, como GitHub Pages. O site tem manifest e service worker para instalação na tela inicial e uso offline depois do primeiro acesso. Para publicar, envie os arquivos para um repositório e ative Pages nas configurações do repositório.

## Sincronização entre aparelhos

Pedidos, histórico, cardápio, estoque, preços e chave Pix podem ser compartilhados pelo Supabase. Para ativar a sincronização, execute no SQL Editor do Supabase, nesta ordem, os scripts `theny-approved-sellers.sql`, `theny-vendedor-permissions.sql` e `supabase/theny-synced-orders.sql`. Se os dois primeiros já foram executados, rode apenas o último.

Depois de executar o script, entre no painel com a conta administradora no aparelho que guarda o cardápio e os pedidos atuais. O app envia os dados locais para o banco e passa a atualizá-los nos outros aparelhos. Pedidos novos enviados pelo catálogo público ficam visíveis só para vendedores aprovados. A conta com permissão de visualização não pode concluir, editar ou excluir pedidos.

Se o celular estiver sem internet, o pedido fica salvo localmente e pode ser importado quando uma conta administradora ou editora entrar no painel com conexão.
