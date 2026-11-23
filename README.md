# Theny Açaí — catálogo e pedidos

Catálogo responsivo e instalável para o cliente montar um pedido no celular e para a vendedora organizar o estoque e os pedidos.

## Como usar

Abra `index.html` em um navegador. O cliente informa o nome, escolhe um produto, marca os complementos e caldas e envia. A vendedora abre **Painel da vendedora** no topo para riscar itens em falta, cadastrar produtos, complementos e caldas, marcar pedidos como realizados, reabri-los ou excluí-los.

As opções e limites seguem a ficha de referência: Potinho permite até 3 complementos e 2 caldas; Copinho permite 1 complemento e 1 calda, além de escolher entre Açaí e Creme.

## Publicar online

Os arquivos são estáticos e podem ser publicados em um serviço de hospedagem estática, como GitHub Pages. O site tem manifest e service worker para instalação na tela inicial e uso offline depois do primeiro acesso. Para publicar, envie os arquivos para um repositório e ative Pages nas configurações do repositório.

## Importante sobre os pedidos

Os pedidos, disponibilidade e opções cadastradas são salvos no navegador e aparelho em uso. Esse fluxo funciona quando a vendedora abre o link no próprio celular e mostra o catálogo ao cliente. Para clientes abrirem o link em seus aparelhos e os pedidos aparecerem no painel da vendedora, será necessário configurar uma conta de banco de dados online.

