// 统一的 tooltip
const tooltip = d3.select("#tooltip");

// 异步加载数据 (假设当前目录下存在这两个文件)
Promise.all([
    d3.csv('train.csv'),
    d3.csv('test.csv')
]).then(function(files) {
    // 合并数据
    let data = [...files[0], ...files[1]];

    // 预处理数据：去除极度缺失的部分，整理格式
    data.forEach(d => {
        d.Age = +d.Age || -1; // -1 represents unknown for now
        d.Fare = +d.Fare || 0;
        d.PclassStr = "Class " + d.Pclass;
        
        // 猜测测试集如果Survied为空，做未知处理，如果有则读取
        if(d.Survived === "1") {
            d.SurviveStatus = "生还";
        } else if (d.Survived === "0") {
            d.SurviveStatus = "遇难";
        } else {
            d.SurviveStatus = "未知";
        }
        
        d.SexStr = d.Sex === "male" ? "男性" : "女性";
        d.EmbarkedStr = d.Embarked === "S" ? "南安普顿 (S)" : 
                        d.Embarked === "C" ? "瑟堡 (C)" : 
                        d.Embarked === "Q" ? "皇后镇 (Q)" : "未知港口";
    });

    drawOverview(data);
    drawSankey(data);
    drawBubble(data);
}).catch(err => {
    console.error("数据加载失败，请确保您是在本地服务器环境下运行，而非直接双击html文件打开以避免CORS报错。", err);
    d3.select("body").append("h2").style("color", "red").text("数据文件读取失败，请开启本地端口服务器预览（VS Code: Open with Live Server）。");
});

// ============================================
// 0. 数据概览：双层嵌套饼图 (Sunburst / Nested Donut)
// ============================================
function drawOverview(data) {
    const container = d3.select("#overview-chart");
    const width = container.node().getBoundingClientRect().width;
    const height = 500;
    const radius = Math.min(width, height) / 2;

    container.html(""); // 清空旧内容（如果需要重绘）

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

    // 构建内外环布局参数
    const innerArc = d3.arc().innerRadius(radius * 0.35).outerRadius(radius * 0.6);
    const outerArc = d3.arc().innerRadius(radius * 0.61).outerRadius(radius * 0.85);

    // 颜色配置
    const innerColor = d3.scaleOrdinal(d3.schemeDark2); // 给内环分类用柔和的Dark2
    const statusColor = d => d === "生还" ? "var(--survived-color)" : 
                             (d === "遇难" ? "var(--died-color)" : "#778da9");

    function getNestedData(dataToNest, groupByField) {
        let groups = d3.group(dataToNest, d => d[groupByField]);
        let result = [];
        for (let [key, vals] of groups) {
            if (!key || key === "未知港口") continue;
            let survived = vals.filter(d => d.SurviveStatus === "生还" || d.SurviveStatus === "生还 (Survived)").length;
            let perished = vals.filter(d => d.SurviveStatus === "遇难" || d.SurviveStatus === "遇难 (Perished)").length;
            let unknown = vals.filter(d => d.SurviveStatus === "未知" || d.SurviveStatus === "未知 (Unknown)").length;

            result.push({
                key: key,
                total: vals.length,
                children: [
                    {status: "生还", count: survived, parentKey: key, parentTotal: vals.length},
                    {status: "遇难", count: perished, parentKey: key, parentTotal: vals.length},
                    {status: "未知", count: unknown, parentKey: key, parentTotal: vals.length}
                ].filter(c => c.count > 0)
            });
        }
        // 为了视觉美观进行排序
        result.sort((a, b) => b.total - a.total);
        return result;
    }

    function updateChart(groupByField) {
        let rootData = getNestedData(data, groupByField);

        // 为了使得切换时不突兀，采用淡出清空、淡入重绘的方式
        svg.transition().duration(250).style("opacity", 0).on("end", () => {
            svg.selectAll("*").remove(); // 清除旧路径

            // 计算内环切片角度
            let pieInner = d3.pie().value(d => d.total).sort(null);
            let innerData = pieInner(rootData);

            // 绘制内环
            svg.selectAll(".inner-slice")
               .data(innerData)
               .enter().append("path")
               .attr("class", "inner-slice")
               .attr("d", innerArc)
               .attr("fill", d => innerColor(d.data.key))
               .attr("stroke", "var(--card-bg)")
               .attr("stroke-width", 2)
               .on("mouseover", function(event, d) {
                   d3.select(this).attr("stroke", "#fff");
                   let percentage = ((d.data.total / data.length) * 100).toFixed(1);
                   tooltip.style("opacity", 1)
                          .html(`<strong>📊 族群：${d.data.key}</strong><br/>
                                 该类总人数: ${d.data.total} 人<br/>
                                 占全船比例: ${percentage}%`)
                          .style("left", (event.pageX + 15) + "px")
                          .style("top", (event.pageY - 28) + "px");
               })
               .on("mousemove", event => tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"))
               .on("mouseout", function() {
                   d3.select(this).attr("stroke", "var(--card-bg)");
                   tooltip.style("opacity", 0);
               });

            // 绘制内环居中文字
            svg.selectAll(".inner-text")
               .data(innerData)
               .enter().append("text")
               .attr("transform", d => `translate(${innerArc.centroid(d)})`)
               .attr("dy", "0.35em")
               .attr("text-anchor", "middle")
               .attr("fill", "#fff")
               .attr("font-size", "14px")
               .attr("font-weight", "bold")
               .attr("pointer-events", "none")
               .text(d => d.data.key);

            // 计算并绘制外环（完美贴合对应内环的角度范围）
            let childData = [];
            innerData.forEach(p => {
                let pieOuter = d3.pie().value(d => d.count).sort(null)
                                .startAngle(p.startAngle).endAngle(p.endAngle);
                childData = childData.concat(pieOuter(p.data.children));
            });

            svg.selectAll(".outer-slice")
               .data(childData)
               .enter().append("path")
               .attr("class", "outer-slice")
               .attr("d", outerArc)
               .attr("fill", d => statusColor(d.data.status))
               .attr("stroke", "var(--card-bg)")
               .attr("stroke-width", 1)
               .on("mouseover", function(event, d) {
                   d3.select(this).attr("stroke", "#fff").attr("stroke-width", 2);
                   let rate = ((d.data.count / d.data.parentTotal) * 100).toFixed(1);
                   tooltip.style("opacity", 1)
                          .html(`<strong>${d.data.parentKey} -> ${d.data.status}</strong><br/>
                                 人数: ${d.data.count} 人<br/>
                                 该群组的生存比率: ${rate}%`)
                          .style("left", (event.pageX + 15) + "px")
                          .style("top", (event.pageY - 28) + "px");
               })
               .on("mousemove", event => tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"))
               .on("mouseout", function() {
                   d3.select(this).attr("stroke", "var(--card-bg)").attr("stroke-width", 1);
                   tooltip.style("opacity", 0);
               });

            // 中心总计文字
            svg.append("text")
               .attr("text-anchor", "middle")
               .attr("dy", "-0.2em")
               .attr("fill", "var(--text-secondary)")
               .attr("font-size", "14px")
               .text("全船记录人数");
               
            svg.append("text")
               .attr("text-anchor", "middle")
               .attr("dy", "1em")
               .attr("fill", "var(--text-primary)")
               .attr("font-size", "24px")
               .attr("font-weight", "bold")
               .text(data.length);

            // 淡入完成
            svg.transition().duration(400).style("opacity", 1);
        });
    }

    // 初始化显示依据类别：按性别
    updateChart("SexStr");

    // 绑定按钮事件
    d3.select("#overview-controls").selectAll("button").on("click", function() {
        d3.select("#overview-controls").selectAll("button").classed("active", false);
        let btn = d3.select(this);
        btn.classed("active", true);

        let id = btn.attr("id");
        if (id === "btn-pie-sex") updateChart("SexStr");
        else if (id === "btn-pie-class") updateChart("PclassStr");
        else if (id === "btn-pie-embarked") updateChart("EmbarkedStr");
    });
}

function drawSankey(data) {
    const container = d3.select("#sankey-chart");
    const width = container.node().getBoundingClientRect().width;
    const height = 500;
    const margin = {top: 20, right: 20, bottom: 20, left: 20};

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height);

    let nodesMap = new Map();
    let linksMap = new Map();

    data.forEach(d => {
        let source1 = d.SexStr;
        let target1 = d.PclassStr;
        
        let source2 = d.PclassStr;
        let target2 = d.SurviveStatus;

        nodesMap.set(source1, {name: source1, category: "sex"});
        nodesMap.set(target1, {name: target1, category: "class"});
        nodesMap.set(target2, {name: target2, category: "outcome"});

        let l1 = source1 + "->" + target1;
        linksMap.set(l1, (linksMap.get(l1) || 0) + 1);

        let l2 = source2 + "->" + target2;
        linksMap.set(l2, (linksMap.get(l2) || 0) + 1);
    });

    let nodes = Array.from(nodesMap.values());
    let links = [];

    linksMap.forEach((val, key) => {
        const parts = key.split("->");
        links.push({
            source: nodes.findIndex(n => n.name === parts[0]),
            target: nodes.findIndex(n => n.name === parts[1]),
            value: val
        });
    });

    const sankey = d3.sankey()
        .nodeWidth(20)
        .nodePadding(30)
        .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

    const {nodes: sankeyNodes, links: sankeyLinks} = sankey({
        nodes: nodes.map(d => Object.assign({}, d)),
        links: links.map(d => Object.assign({}, d))
    });

    const colorScale = d3.scaleOrdinal()
        .domain(["生还", "遇难", "未知", "男性", "女性", "Class 1", "Class 2", "Class 3"])
        .range(["#00b4d8", "#ef233c", "#4a4e69", "#4361ee", "#f72585", "#fca311", "#e5e5e5", "#babb74"]);

    const link = svg.append("g")
        .selectAll(".link")
        .data(sankeyLinks)
        .enter().append("path")
        .attr("class", "link")
        .attr("d", d3.sankeyLinkHorizontal())
        .attr("stroke", d => colorScale(d.source.name))
        .attr("stroke-width", d => Math.max(1, d.width))
        .on("mouseover", function(event, d) {
            d3.selectAll(".link").style("stroke-opacity", 0.1);
            d3.select(this).style("stroke-opacity", 0.8);
            
            tooltip.style("opacity", 1)
                   .html(`<strong>${d.source.name} → ${d.target.name}</strong><br/>人数: ${d.value} 人`)
                   .style("left", (event.pageX + 15) + "px")
                   .style("top", (event.pageY - 28) + "px");
        })
        .on("mousemove", event => {
            tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function() {
            d3.selectAll(".link").style("stroke-opacity", 0.3);
            tooltip.style("opacity", 0);
        });

    const node = svg.append("g")
        .selectAll(".node")
        .data(sankeyNodes)
        .enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.x0},${d.y0})`);

    node.append("rect")
        .attr("height", d => d.y1 - d.y0)
        .attr("width", d => d.x1 - d.x0)
        .attr("fill", d => colorScale(d.name))
        .attr("stroke", "#fff");

    node.append("text")
        .attr("x", -6)
        .attr("y", d => (d.y1 - d.y0) / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .text(d => d.name)
        .filter(d => d.x0 < width / 2)
        .attr("x", 6 + sankey.nodeWidth())
        .attr("text-anchor", "start");
}

function drawBubble(data) {
    const container = d3.select("#bubble-chart");
    const width = container.node().getBoundingClientRect().width;
    const height = 500;

    let validData = data.filter(d => d.Age > 0);

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height);

    const color = d => d.Survived === "1" ? "var(--survived-color)" : 
                       (d.Survived === "0" ? "var(--died-color)" : "#778da9");

    const radiusScale = d3.scaleSqrt()
        .domain([0, 10]) 
        .range([4, 12]);

    validData.forEach(d => {
        d.x = width / 2 + (Math.random() - 0.5) * 100;
        d.y = height / 2 + (Math.random() - 0.5) * 100;
        d.r = radiusScale(d.SibSp || 1);
    });

    const node = svg.selectAll(".bubble")
        .data(validData)
        .enter().append("circle")
        .attr("class", "bubble")
        .attr("r", d => d.r)
        .attr("fill", d => color(d))
        .on("mouseover", function(event, d) {
            d3.select(this).attr("stroke", "#fff").attr("stroke-width", 2);
            tooltip.style("opacity", 1)
                   .html(`
                       <strong>${d.Name}</strong><br/>
                       客舱等级: ${d.Pclass} | 状态: ${d.SurviveStatus}<br/>
                       年龄: ${d.Age} 岁 | 票价: £${parseFloat(d.Fare).toFixed(2)}<br/>
                       同行家属: <strong>${d.SibSp || 0} 人</strong>
                   `)
                   .style("left", (event.pageX + 15) + "px")
                   .style("top", (event.pageY - 28) + "px");
        })
        .on("mousemove", event => {
            tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function() {
            d3.select(this).attr("stroke", "rgba(255, 255, 255, 0.3)").attr("stroke-width", 1);
            tooltip.style("opacity", 0);
        });

    const simulation = d3.forceSimulation(validData)
        .force("collide", d3.forceCollide().radius(d => d.r + 1).iterations(2));

    function groupAll() {
        simulation
            .force("x", d3.forceX(width / 2).strength(0.04))
            .force("y", d3.forceY(height / 2).strength(0.04))
            .alpha(1).restart();
    }

    function groupBySurvived() {
        simulation
            .force("x", d3.forceX(d => {
                if (d.Survived === "1") return width * 0.25;
                if (d.Survived === "0") return width * 0.75;
                return width * 0.5;
            }).strength(0.08))
            .force("y", d3.forceY(height / 2).strength(0.05))
            .alpha(1).restart();

        addBgText("生还区", width * 0.25);
        addBgText("遇难区", width * 0.75);
    }

    function groupByClass() {
        simulation
            .force("x", d3.forceX(d => {
                if (d.Pclass === "1") return width * 0.2;
                if (d.Pclass === "2") return width * 0.5;
                if (d.Pclass === "3") return width * 0.8;
                return width * 0.5;
            }).strength(0.08))
            .force("y", d3.forceY(height / 2).strength(0.05))
            .alpha(1).restart();

        addBgText("一等舱", width * 0.2);
        addBgText("二等舱", width * 0.5);
        addBgText("三等舱", width * 0.8);
    }

    simulation.on("tick", () => {
        node.attr("cx", d => d.x)
            .attr("cy", d => d.y);
    });

    let bgTexts = svg.append("g").attr("class", "bg-text-group");
    function addBgText(text, xPos) {
        bgTexts.append("text")
            .attr("x", xPos)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("fill", "rgba(255,255,255,0.1)")
            .attr("font-size", "40px")
            .attr("font-weight", "bold")
            .attr("pointer-events", "none")
            .text(text);
    }
    function clearBgText() {
        bgTexts.selectAll("*").remove();
    }

    groupAll();

    d3.select("#btn-all").on("click", function() {
        clearBtnActive(); d3.select(this).classed("active", true);
        clearBgText();
        groupAll();
    });
    
    d3.select("#btn-survived").on("click", function() {
        clearBtnActive(); d3.select(this).classed("active", true);
        clearBgText();
        groupBySurvived();
    });

    d3.select("#btn-class").on("click", function() {
        clearBtnActive(); d3.select(this).classed("active", true);
        clearBgText();
        groupByClass();
    });

    function clearBtnActive() {
        d3.selectAll(".controls button").classed("active", false);
    }
}